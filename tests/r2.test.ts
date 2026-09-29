import { describe, it, expect } from "vitest";
import { signV4, sha256Hex, encodePath, amzNow } from "../api/_r2";
import { classify, parseJsonLoose } from "../api/_llm";

const EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

describe("AWS SigV4 signer (R2)", () => {
  it("matches AWS test suite: get-vanilla", async () => {
    const r = await signV4({
      method: "GET", host: "example.amazonaws.com", path: "/",
      headers: { Host: "example.amazonaws.com", "X-Amz-Date": "20150830T123600Z" },
      payloadHash: EMPTY, region: "us-east-1", service: "service",
      accessKey: "AKIDEXAMPLE", secretKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY", amzDate: "20150830T123600Z",
    });
    expect(r.signature).toBe("5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31");
  });
  it("matches the S3 GET Object documentation example", async () => {
    const r = await signV4({
      method: "GET", host: "examplebucket.s3.amazonaws.com", path: "/test.txt",
      headers: { host: "examplebucket.s3.amazonaws.com", range: "bytes=0-9", "x-amz-content-sha256": EMPTY, "x-amz-date": "20130524T000000Z" },
      payloadHash: EMPTY, region: "us-east-1", service: "s3",
      accessKey: "AKIAIOSFODNN7EXAMPLE", secretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", amzDate: "20130524T000000Z",
    });
    expect(r.signature).toBe("f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
  });
  it("hashes and encodes like S3 expects", async () => {
    expect(await sha256Hex("")).toBe(EMPTY);
    expect(encodePath("products/2026-09/K5208 (W).webp")).toBe("products/2026-09/K5208%20%28W%29.webp");
    expect(amzNow(new Date("2026-09-28T10:20:30.456Z"))).toBe("20260928T102030Z");
  });
});

describe("AI provider fallback helpers", () => {
  it("recognises an empty OpenAI wallet vs a rate limit", () => {
    expect(classify(429, { error: { code: "insufficient_quota", message: "You exceeded your current quota" } })).toBe("quota");
    expect(classify(429, { error: { message: "Rate limit reached" } })).toBe("rate_limit");
    expect(classify(500, {})).toBe("error");
  });
  it("parses JSON even when wrapped in a code fence", () => {
    expect(parseJsonLoose('```json\n{"a":1}\n```').a).toBe(1);
  });
});
