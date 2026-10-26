import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { apiUrl } from "./platform";
import { db, getSetting, setSetting, rebuildStock, now, put } from "./db";
import { rfidDefaults } from "./rfid";
import { ownerOnly } from "./scope";
import { COLUMNS } from "./columns";
import { cloudSyncEnabled, assertCloudSyncEnabled } from "./cloudMode";

/* Local-first sync.
   - Every save goes to IndexedDB + an outbox row, so the shop never waits on the internet.
   - When online, the outbox is pushed (upsert by id) and newer rows are pulled per table.
   - Conflicts: last write wins by updated_at for master data; movements are append-only,
     so two phones recording at the same time can never overwrite each other. */

const TABLES = ["stores", "config", "staff", "locations", "parties", "products", "movements", "bills", "receipts", "purchases", "purchase_returns", "vouchers", "fiscal_year_closes", "voice_notes", "store_transfers", "bank_lines", "import_batches", "dealers", "trade_orders"] as const;
const PHOTO_TABLES = ["products", "movements", "bills", "parties", "purchases"];
type T = (typeof TABLES)[number];

export type SyncState = { status: "local" | "idle" | "syncing" | "error" | "offline"; pending: number; last?: string; error?: string; user?: string; cloudEnabled?: boolean };
let state: SyncState = { status: "local", pending: 0 };
const subs = new Set<(s: SyncState) => void>();
const emit = (p: Partial<SyncState>) => { state = { ...state, ...p }; subs.forEach(f => f(state)); };
export const onSync = (f: (s: SyncState) => void) => { subs.add(f); f(state); return () => subs.delete(f); };

let client: SupabaseClient | null = null;

export async function cloudConfig(): Promise<{ url: string; key: string } | null> {
  const env = { url: import.meta.env.VITE_SUPABASE_URL as string, key: import.meta.env.VITE_SUPABASE_ANON_KEY as string };
  if (env.url && env.key) return env;
  const s = await getSetting<{ url: string; key: string } | null>("cloud", null);
  return s && s.url && s.key ? s : null;
}

export async function sb(): Promise<SupabaseClient | null> {
  if (client) return client;
  const c = await cloudConfig();
  if (!c) return null;
  client = createClient(c.url, c.key, { auth: { persistSession: true, storageKey: "rj_auth" } });
  return client;
}
export function resetClient() { client = null; }

/* Supabase's own words, turned into what to actually do. Each of these was hit for real. */
export function authHelp(msg: string): string {
  const m = msg || "";
  if (/email address .* is invalid|email_address_invalid/i.test(m))
    return "Supabase refused that email: it can't receive mail. Use a real address you can open, such as the owner's Gmail.";
  if (/rate limit|over_email_send_rate_limit/i.test(m))
    return "Supabase is trying to send a confirmation email and has hit its hourly limit. Switch it off once: Supabase → Authentication → Sign In / Providers → Email → turn off “Confirm email” → Save. Then press this button again.";
  if (/email not confirmed/i.test(m))
    return "This login is waiting for its confirmation email. Open that email, or switch off “Confirm email” in Supabase → Authentication → Sign In / Providers → Email, then sign in again.";
  return "";
}

export async function signIn(email: string, password: string) {
  const c = await sb(); if (!c) throw new Error("Cloud is not connected yet");
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(authHelp(error.message) || error.message);
  syncNow();
}
export async function signOut() { const c = await sb(); await setSetting("shop_device", false); await c?.auth.signOut(); emit({ user: undefined }); }

/* Owner, 22 Oct (voice note): "it keeps asking me to create the company again and again — three times now".
   Every new computer, browser or app install started empty, asked for the owner's name and PIN, and then
   for an email and password in Settings › Cloud backup. He made a new login each time (six logins in the
   cloud today), and the new computer's blank "Owner" replaced his real owner in the cloud.

   Now a device that has passed the shop's entry code connects itself: an old session is refreshed, and a
   device with none signs in as an unnamed shop device (Supabase anonymous sign-in). Nobody types an email
   or password to sync, read purchase bills or print their stickers. The owner's email login still works
   and is still what proves the owner (owner PIN reset, GST). */
const SHOP_DEVICE = "shop_device";
export const markShopDevice = () => setSetting(SHOP_DEVICE, true);
let anonRefused = 0;   // the project has anonymous sign-ins switched off: don't ask again for 10 minutes
export async function ensureSession(): Promise<boolean> {
  const c = await sb(); if (!c || !navigator.onLine) return false;
  if ((await c.auth.getSession()).data.session) return true;
  if (!await getSetting<boolean>(SHOP_DEVICE, false)) return false;   // only after this device passed the entry code
  if (Date.now() - anonRefused < 600_000) return false;
  try {
    const { data, error } = await c.auth.signInAnonymously();
    if (error || !data.session) { anonRefused = Date.now(); return false; }
    return true;
  } catch { anonRefused = Date.now(); return false; }
}
/** Who this device is connected as, in words for the screen. */
export const deviceLabel = (u?: { email?: string | null; is_anonymous?: boolean } | null) => u?.email || (u ? "this shop device" : "");

/* The shop's cloud login has to exist before anything can sync, and before the AI
   can read a purchase bill — the bill reader checks this session before it spends a
   single rupee of AI credit. Making it from inside the app means the password is
   typed once, here, by the owner: it never goes through a dashboard, a message or
   anyone else's hands. First time only; afterwards this is an ordinary sign-in. */
export async function createShopLogin(email: string, password: string): Promise<"ready" | "confirm"> {
  const c = await sb(); if (!c) throw new Error("Cloud is not connected yet");
  if (password.length < 8) throw new Error("Use at least 8 characters, and keep it somewhere safe — it is the shop's own login");
  const { data, error } = await c.auth.signUp({ email, password });
  if (error) {
    const why = authHelp(error.message);
    if (why) throw new Error(why);
    // already made on another device (or an earlier try): this is simply a sign-in
    if (/already registered|already exists|user already/i.test(error.message)) { await signIn(email, password); return "ready"; }
    if (/signups? not allowed|disabled/i.test(error.message))
      throw new Error("This project does not allow creating a login from the app. Turn on sign-ups in Supabase → Authentication → Sign In / Providers, or add the user there.");
    throw error;
  }
  if (!data.session) return "confirm";          // e-mail confirmation is switched on
  syncNow();
  return "ready";
}

async function pendingCount() { const n = await db.outbox.count(); emit({ pending: n }); return n; }

/* ---------- push ---------- */
/* Product / bill / party photos go to Cloudflare R2 through our own /api/media
   function (which holds the R2 keys). Images are never stored in Supabase.
   If R2 isn't set up yet, or the upload fails, photos simply stay on this device
   and are retried next sync — stock and bill sync is never held up by a photo. */
const blobB64 = (b: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] || ""); r.onerror = rej; r.readAsDataURL(b); });
let r2Off = 0; // time R2 last said "not configured" — don't ask again for 10 minutes

async function uploadPhotos(c: SupabaseClient) {
  if (Date.now() - r2Off < 600_000) return;
  const list = await db.photos.where("uploaded").equals(0).limit(20).toArray();
  if (!list.length) return;
  const token = (await c.auth.getSession()).data.session?.access_token || "";
  for (const p of list) {
    await assertCloudSyncEnabled();
    let url = "";
    try {
      const r = await fetch(apiUrl("media"), {
        method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + token },
        body: JSON.stringify({ data: await blobB64(p.blob), mime: p.blob.type || "image/jpeg", key: `photos/${p.created_at.slice(0, 7)}/${p.id}` }),
      });
      const j: any = await r.json().catch(() => ({}));
      if (r.status === 503 && j.code === "no_r2") { r2Off = Date.now(); return; }
      if (!r.ok || !j.url) { console.warn("photo upload failed", j.error || r.status); return; }
      url = j.url;
    } catch (e) { console.warn("photo upload failed", e); return; }
    await db.photos.update(p.id, { uploaded: 1, url });
    // stamp the url onto whatever row uses this photo (raw photo or polished catalogue photo)
    for (const t of PHOTO_TABLES) {
      const rows = await (db as any)[t].filter((r: any) => r.photo_id === p.id || r.pro_photo_id === p.id).toArray();
      for (const r of rows) {
        if (r.photo_id === p.id) r.photo_url = url;
        if (r.pro_photo_id === p.id) r.pro_photo_url = url;
        r.updated_at = now();
        await (db as any)[t].put(r);
        await db.outbox.add({ table: t, row_id: r.id, at: r.updated_at, tries: 0 });
      }
    }
  }
}

/* Voice notes: small Opus/AAC clips, uploaded once, then the note row gets the link. */
async function uploadVoice(c: SupabaseClient) {
  const list = await db.voice_blobs.where("uploaded").equals(0).limit(10).toArray();
  for (const v of list) {
    await assertCloudSyncEnabled();
    const ext = v.blob.type.includes("mp4") ? "m4a" : v.blob.type.includes("ogg") ? "ogg" : "webm";
    const path = `${v.created_at.slice(0, 7)}/${v.id}.${ext}`;
    const up = await c.storage.from("voice").upload(path, v.blob, { contentType: (v.blob.type || "audio/webm").split(";")[0], upsert: true, cacheControl: "31536000" });
    if (up.error) throw up.error;
    const url = c.storage.from("voice").getPublicUrl(path).data.publicUrl;
    await db.voice_blobs.update(v.id, { uploaded: 1, url });
    const n = await db.voice_notes.get(v.id);
    if (n) { n.url = url; n.updated_at = now(); await db.voice_notes.put(n); await db.outbox.add({ table: "voice_notes", row_id: n.id, at: n.updated_at, tries: 0 }); }
  }
}

/* Only columns the cloud table really has are sent: a field kept only on this device (a draft marker,
   a newer app version's field) must never stop the whole shop's sync. */
const missingTable = (e: { code?: string; message?: string }) => e.code === "PGRST205" || e.code === "42P01" || /could not find the table|does not exist/i.test(e.message || "");

/* A column added by a newer migration that this shop's cloud hasn't run yet (e.g. bills.helper).
   The cloud answers "Could not find the 'helper' column"; we stop sending just that column
   instead of refusing whole bills. It is kept on the device and sent once the column exists. */
const missingCols: Record<string, Set<string>> = {};
export function missingColumn(t: string, message?: string): string | undefined {
  const m = /could not find the '(\w+)' column/i.exec(message || "") || /column "?(\w+)"? of relation "?\w+"? does not exist/i.exec(message || "");
  if (!m || !COLUMNS[t]?.includes(m[1]) || missingCols[t]?.has(m[1])) return undefined;
  (missingCols[t] ||= new Set()).add(m[1]);
  return m[1];
}
export const strip = (t: T, r0: any) => {
  const { photo_id, ...rest } = rfidDefaults(t, r0);
  const row: any = PHOTO_TABLES.includes(t) ? { ...rest, photo_id: photo_id || null } : rest;
  const cols = COLUMNS[t];
  if (!cols) return row;
  const out: any = {};
  for (const k of cols) if (k in row && row[k] !== undefined && !missingCols[t]?.has(k)) out[k] = row[k];
  return out;
};

async function push(c: SupabaseClient) {
  const skip = new Set<number>(); // rows the cloud refused this round: kept in the outbox, retried next sync
  for (;;) {
    await assertCloudSyncEnabled();
    const batch = (await db.outbox.orderBy("seq").limit(200 + skip.size).toArray()).filter(b => !skip.has(b.seq!)).slice(0, 200);
    if (!batch.length) break;
    const done: number[] = [];
    for (const t of TABLES) {
      await assertCloudSyncEnabled();
      const items = batch.filter(b => b.table === t);
      if (!items.length) continue;
      const ids = [...new Set(items.map(i => i.row_id))];
      const local = (await (db as any)[t].bulkGet(ids)).filter(Boolean);
      let rows = local.map((r: any) => strip(t, r));
      let error = rows.length ? (await c.from(t).upsert(rows, { onConflict: "id" })).error : null;
      while (error && missingColumn(t, error.message)) {   // cloud is behind on a migration: drop that column, retry
        rows = local.map((r: any) => strip(t, r));
        error = (await c.from(t).upsert(rows, { onConflict: "id" })).error;
      }
      if (error && /fetch|network|timeout|jwt|auth/i.test(error.message || "")) throw error; // offline / signed out: try everything later
      if (!error) { done.push(...items.map(i => i.seq!)); continue; }
      // one bad row must not hold back the rest: send them one by one and park only the refused ones
      for (const r of rows) {
        await assertCloudSyncEnabled();
        const e = (await c.from(t).upsert([r], { onConflict: "id" })).error;
        const mine = items.filter(i => i.row_id === r.id);
        if (e && t === "products" && isCodeClash(e) && await adoptCloudProduct(c, r.id, r.code)) { done.push(...mine.map(i => i.seq!)); continue; }
        if (!e) done.push(...mine.map(i => i.seq!));
        else for (const i of mine) { skip.add(i.seq!); await db.outbox.update(i.seq!, { tries: (i.tries || 0) + 1, last_error: e.message }); }
      }
      error = null;
    }
    // outbox rows whose record no longer exists locally are done too
    done.push(...batch.filter(b => !done.includes(b.seq!) && !skip.has(b.seq!)).map(b => b.seq!));
    await db.outbox.bulkDelete(done);
    await pendingCount();
  }
  if (skip.size) throw new Error(`${skip.size} change${skip.size > 1 ? "s" : ""} could not be saved to the cloud — see Settings › Sync`);
}

/* The same product made on two devices (22 Oct: the new Windows app had 17 products whose codes were
   already in the cloud under other ids, so "Sync problem · 20" never cleared and their stock movements
   were refused too). A product code is the product — it is on its printed stickers — so this device takes
   the cloud's product and moves its own stock, bills and purchases onto it. Nothing is lost: this device's
   newer details are kept on the cloud's row. */
export const isCodeClash = (e: { code?: string; message?: string }) => /products_code_uq/i.test(e.message || "");
export async function adoptCloudProduct(c: SupabaseClient, localId: string, code: string): Promise<boolean> {
  if (!code) return false;
  const { data, error } = await c.from("products").select("*").eq("code", code).limit(1);
  const cloud: any = !error && data?.[0];
  if (!cloud || cloud.id === localId) return false;
  const local: any = await db.products.get(localId);
  const newer = !!local && local.updated_at > cloud.updated_at;
  const swap = (row: any) => JSON.parse(JSON.stringify(row).split(localId).join(cloud.id));
  for (const t of TABLES) {
    if (t === "products") continue;
    const table = (db as any)[t];
    const rows = await table.filter((r: any) => JSON.stringify(r).includes(localId)).toArray();
    for (const r of rows) await put(t as any, swap(r));
  }
  await db.transaction("rw", db.products, db.outbox, async () => {
    await db.products.delete(localId);
    await db.outbox.where("table").equals("products").filter(x => x.row_id === localId).delete();
  });
  if (newer) await put("products", { ...cloud, ...local, id: cloud.id, code: cloud.code, created_at: cloud.created_at });
  else await db.products.put({ ...cloud, photo_id: local?.photo_id || cloud.photo_id || undefined });
  await rebuildStock();
  return true;
}

/* ---------- pull ---------- */
async function pull(c: SupabaseClient) {
  let movedStock = false;
  try {
    for (const t of TABLES) {
      const cursor = await getSetting<string>("cursor_" + t, "1970-01-01T00:00:00Z");
      // Replay one fixed overlap window per run; pages then move strictly forward within it.
      const since = new Date(new Date(cursor).getTime() - 5000).toISOString();
      let after: { updated_at: string; id: string } | undefined;
      let newest = cursor;
      for (;;) {
        await assertCloudSyncEnabled();
        let query = c.from(t).select("*").gt("updated_at", since);
        if (after) {
          // PostgREST quoted literals also support text config IDs containing commas/quotes/backslashes.
          const time = JSON.stringify(after.updated_at), id = JSON.stringify(after.id);
          query = query.or(`updated_at.gt.${time},and(updated_at.eq.${time},id.gt.${id})`);
        }
        const { data, error } = await query.order("updated_at").order("id").limit(1000);
        if (error && missingTable(error)) break;
        if (error) throw error;
        if (!data || !data.length) break;
        const table = (db as any)[t];
        const locals = await table.bulkGet(data.map((r: any) => r.id));
        const fresh = data.map((r: any, i: number) => ({ r, l: locals[i] }))
          .filter(({ r, l }: any) => !l || l.updated_at < r.updated_at)
          .map(({ r, l }: any) => ({ ...r, photo_id: l?.photo_id || r.photo_id || undefined }));
        if (fresh.length) { await table.bulkPut(fresh); if (t === "movements") movedStock = true; }
        const last = data[data.length - 1];
        if (after && last.updated_at === after.updated_at && last.id === after.id) throw new Error("Cloud pagination did not advance for " + t);
        after = { updated_at: last.updated_at, id: last.id };
        if (Date.parse(last.updated_at) >= Date.parse(newest)) newest = last.updated_at;
        if (data.length < 1000) break;
      }
      // Commit the high-water mark only after draining the table; failed runs can replay safely.
      if (newest !== cursor) await setSetting("cursor_" + t, newest);
    }
  } finally {
    // Applied movement pages must update stock even if a later page fails or the owner pauses sync.
    if (movedStock) await rebuildStock();
  }
}

let running = false;
export async function syncNow() {
  if (running) return;
  running = true;
  try {
    await pendingCount();
    const enabled = await cloudSyncEnabled();
    emit({ cloudEnabled: enabled });
    if (!enabled) { emit({ status: "local", error: undefined }); return; }
    if (!navigator.onLine) { emit({ status: "offline", error: undefined }); return; }
    const c = await sb();
    if (!c) { emit({ status: "local", error: undefined }); return; }
    let { data } = await c.auth.getSession();
    if (!data.session && await ensureSession()) data = (await c.auth.getSession()).data;
    if (!data.session) { emit({ status: "idle", error: "Sign in to sync", user: undefined }); return; }
    emit({ status: "syncing", error: undefined, user: deviceLabel(data.session.user) });
    await assertCloudSyncEnabled();
    await uploadPhotos(c);
    await uploadVoice(c).catch(() => { /* voice bucket missing must never block stock sync */ });
    await push(c);
    await pull(c);
    emit({ status: "idle", last: now() });
  } catch (e: any) {
    const enabled = await cloudSyncEnabled();
    emit(enabled ? { status: "error", error: e?.message || String(e) } : { status: "local", cloudEnabled: false, error: undefined });
  } finally { running = false; await pendingCount(); }
}

let started = false;
export function startSync() {
  if (started) return; started = true;
  syncNow();
  setInterval(syncNow, 20_000);
  window.addEventListener("online", () => syncNow());
  window.addEventListener("offline", () => emit({ status: "offline" }));
  document.addEventListener("visibilitychange", () => { if (!document.hidden) syncNow(); });
}

/* ---------- backup: the shop's data can always leave the building on a pen drive ---------- */
export async function exportAll() {
  ownerOnly();
  const out: any = { app: "rungnna", version: 1, at: now() };
  for (const t of [...TABLES, "settings"] as const) out[t] = await (db as any)[t].toArray();
  return new Blob([JSON.stringify(out)], { type: "application/json" });
}
export async function importAll(file: File) {
  ownerOnly();
  const j = JSON.parse(await file.text());
  if (j.app !== "rungnna") throw new Error("Not a Rungnna backup file");
  for (const t of TABLES) if (Array.isArray(j[t])) {
    await (db as any)[t].bulkPut(j[t]);
    await db.outbox.bulkAdd(j[t].map((r: any) => ({ table: t, row_id: r.id, at: now(), tries: 0 })));
  }
  await rebuildStock();
}
