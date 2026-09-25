import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { db, getSetting, setSetting, rebuildStock, now } from "./db";

/* Local-first sync.
   - Every save goes to IndexedDB + an outbox row, so the shop never waits on the internet.
   - When online, the outbox is pushed (upsert by id) and newer rows are pulled per table.
   - Conflicts: last write wins by updated_at for master data; movements are append-only,
     so two phones recording at the same time can never overwrite each other. */

const TABLES = ["config", "staff", "locations", "parties", "products", "movements", "bills", "voice_notes"] as const;
const PHOTO_TABLES = ["products", "movements", "bills", "parties"];
type T = (typeof TABLES)[number];

export type SyncState = { status: "local" | "idle" | "syncing" | "error" | "offline"; pending: number; last?: string; error?: string; user?: string };
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

export async function signIn(email: string, password: string) {
  const c = await sb(); if (!c) throw new Error("Cloud is not connected yet");
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error;
  syncNow();
}
export async function signOut() { const c = await sb(); await c?.auth.signOut(); emit({ user: undefined }); }

async function pendingCount() { const n = await db.outbox.count(); emit({ pending: n }); return n; }

/* ---------- push ---------- */
async function uploadPhotos(c: SupabaseClient) {
  const list = await db.photos.where("uploaded").equals(0).limit(20).toArray();
  for (const p of list) {
    const ext = p.blob.type === "image/webp" ? "webp" : "jpg";
    const path = `${p.created_at.slice(0, 7)}/${p.id}.${ext}`;
    const up = await c.storage.from("photos").upload(path, p.blob, { contentType: p.blob.type, upsert: true, cacheControl: "31536000" });
    if (up.error) throw up.error;
    const url = c.storage.from("photos").getPublicUrl(path).data.publicUrl;
    await db.photos.update(p.id, { uploaded: 1, url });
    // stamp the url onto whatever row uses this photo
    for (const t of PHOTO_TABLES) {
      const rows = await (db as any)[t].filter((r: any) => r.photo_id === p.id).toArray();
      for (const r of rows) {
        r.photo_url = url; r.updated_at = now();
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

const strip = (t: T, r: any) => {
  const { photo_id, ...rest } = r;
  if (PHOTO_TABLES.includes(t)) return { ...rest, photo_id: photo_id || null };
  return rest;
};

async function push(c: SupabaseClient) {
  for (;;) {
    const batch = await db.outbox.orderBy("seq").limit(200).toArray();
    if (!batch.length) break;
    for (const t of TABLES) {
      const items = batch.filter(b => b.table === t);
      if (!items.length) continue;
      const ids = [...new Set(items.map(i => i.row_id))];
      const rows = (await (db as any)[t].bulkGet(ids)).filter(Boolean).map((r: any) => strip(t, r));
      if (rows.length) {
        const { error } = await c.from(t).upsert(rows, { onConflict: "id" });
        if (error) throw error;
      }
    }
    await db.outbox.bulkDelete(batch.map(b => b.seq!));
    await pendingCount();
  }
}

/* ---------- pull ---------- */
async function pull(c: SupabaseClient) {
  let movedStock = false;
  for (const t of TABLES) {
    let cursor = await getSetting<string>("cursor_" + t, "1970-01-01T00:00:00Z");
    for (;;) {
      const since = new Date(new Date(cursor).getTime() - 5000).toISOString(); // small overlap: late commits are never skipped
      const { data, error } = await c.from(t).select("*").gt("updated_at", since).order("updated_at").limit(1000);
      if (error) throw error;
      if (!data || !data.length) break;
      const table = (db as any)[t];
      const locals = await table.bulkGet(data.map((r: any) => r.id));
      const fresh = data.map((r: any, i: number) => ({ r, l: locals[i] }))
        .filter(({ r, l }: any) => !l || l.updated_at < r.updated_at)
        .map(({ r, l }: any) => ({ ...r, photo_id: l?.photo_id || r.photo_id || undefined }));
      if (fresh.length) { await table.bulkPut(fresh); if (t === "movements") movedStock = true; }
      const last = data[data.length - 1].updated_at;
      if (last === cursor) break;
      cursor = last;
      await setSetting("cursor_" + t, cursor);
      if (data.length < 1000) break;
    }
  }
  if (movedStock) await rebuildStock();
}

let running = false;
export async function syncNow() {
  await pendingCount();
  if (running) return;
  const c = await sb();
  if (!c) { emit({ status: "local" }); return; }
  if (!navigator.onLine) { emit({ status: "offline" }); return; }
  const { data } = await c.auth.getSession();
  if (!data.session) { emit({ status: "idle", error: "Sign in to sync", user: undefined }); return; }
  running = true; emit({ status: "syncing", error: undefined, user: data.session.user.email || "" });
  try {
    await uploadPhotos(c);
    await uploadVoice(c).catch(() => { /* voice bucket missing must never block stock sync */ });
    await push(c);
    await pull(c);
    emit({ status: "idle", last: now() });
  } catch (e: any) {
    emit({ status: "error", error: e?.message || String(e) });
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
  const out: any = { app: "rungnna", version: 1, at: now() };
  for (const t of [...TABLES, "settings"] as const) out[t] = await (db as any)[t].toArray();
  return new Blob([JSON.stringify(out)], { type: "application/json" });
}
export async function importAll(file: File) {
  const j = JSON.parse(await file.text());
  if (j.app !== "rungnna") throw new Error("Not a Rungnna backup file");
  for (const t of TABLES) if (Array.isArray(j[t])) {
    await (db as any)[t].bulkPut(j[t]);
    await db.outbox.bulkAdd(j[t].map((r: any) => ({ table: t, row_id: r.id, at: now(), tries: 0 })));
  }
  await rebuildStock();
}
