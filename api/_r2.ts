import { env } from "./_lib.js";

/* ===========================================================================
   Cloudflare R2 — the ONLY place product images are stored.

   R2 speaks the S3 API, which needs AWS Signature V4 on every request. This is a
   small, dependency-free signer on Web Crypto (works on Vercel's Node runtime and
   anywhere else), checked against AWS's published test vector in tests/r2.test.ts.

   Env (Vercel → Settings → Environment Variables):
     R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET,
     R2_PUBLIC_URL  — the bucket's public base URL (r2.dev or a custom domain)
=========================================================================== */

const enc = new TextEncoder();
const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  // copy into a fresh buffer: satisfies BufferSource typing on every TS version
  const bytes = typeof data === "string" ? enc.encode(data) : new Uint8Array(data);
  return hex(await crypto.subtle.digest("SHA-256", bytes));
}
async function hmac(key: Uint8Array, msg: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", new Uint8Array(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(msg)));
}

/* base64 without Node's Buffer (portable across runtimes) */
export function b64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  return btoa(s);
}
export function fromB64(s: string): Uint8Array {
  const bin = atob(s.replace(/^data:[^,]*,/, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* RFC 3986 encoding per path segment, as S3 requires. */
export const encodePath = (p: string) =>
  p.split("/").map(s => encodeURIComponent(s).replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase())).join("/");

export type SignInput = {
  method: string; host: string; path: string; query?: string;
  headers: Record<string, string>;         // must include host + x-amz-date; every header given is signed
  payloadHash: string;
  region: string; service: string;
  accessKey: string; secretKey: string;
  amzDate: string;                          // YYYYMMDD'T'HHMMSS'Z'
};

/* Returns the Authorization header value for a SigV4 request. */
export async function signV4(s: SignInput): Promise<{ authorization: string; signature: string; canonical: string }> {
  const h = Object.entries(s.headers).map(([k, v]) => [k.toLowerCase().trim(), String(v).trim().replace(/\s+/g, " ")] as [string, string])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const canonicalHeaders = h.map(([k, v]) => `${k}:${v}\n`).join("");
  const signedHeaders = h.map(([k]) => k).join(";");
  const canonical = [s.method.toUpperCase(), s.path, s.query || "", canonicalHeaders, signedHeaders, s.payloadHash].join("\n");
  const date = s.amzDate.slice(0, 8);
  const scope = `${date}/${s.region}/${s.service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", s.amzDate, scope, await sha256Hex(canonical)].join("\n");
  let k = await hmac(enc.encode("AWS4" + s.secretKey), date);
  k = await hmac(k, s.region); k = await hmac(k, s.service); k = await hmac(k, "aws4_request");
  const signature = hex(await hmac(k, toSign));
  return { authorization: `AWS4-HMAC-SHA256 Credential=${s.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`, signature, canonical };
}

export const r2Configured = () => !!(env("R2_ACCOUNT_ID") && env("R2_ACCESS_KEY_ID") && env("R2_SECRET_ACCESS_KEY") && env("R2_BUCKET") && env("R2_PUBLIC_URL"));

export const amzNow = (d = new Date()) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/* Upload one object and return its public URL. */
export async function r2Put(key: string, body: Uint8Array, contentType: string): Promise<string> {
  if (!r2Configured()) throw Object.assign(new Error("Cloudflare R2 is not set up yet (R2_* environment variables)"), { status: 503 });
  const host = `${env("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`;
  const path = "/" + encodePath(`${env("R2_BUCKET")}/${key}`);
  const amzDate = amzNow();
  const payloadHash = await sha256Hex(body);
  const headers: Record<string, string> = {
    host, "x-amz-date": amzDate, "x-amz-content-sha256": payloadHash,
    "content-type": contentType, "cache-control": "public, max-age=31536000, immutable",
  };
  const { authorization } = await signV4({ method: "PUT", host, path, headers, payloadHash, region: "auto", service: "s3", accessKey: env("R2_ACCESS_KEY_ID"), secretKey: env("R2_SECRET_ACCESS_KEY"), amzDate });
  const { host: _h, ...send } = headers;
  const r = await fetch(`https://${host}${path}`, { method: "PUT", headers: { ...send, authorization }, body: body as any, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    const code = t.match(/<Code>([^<]+)<\/Code>/)?.[1] || String(r.status);
    throw Object.assign(new Error(`R2 upload failed (${code})`), { status: 502 });
  }
  return `${env("R2_PUBLIC_URL").replace(/\/+$/, "")}/${encodePath(key)}`;
}
