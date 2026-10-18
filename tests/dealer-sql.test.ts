import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { describe, expect, it, beforeAll, afterAll } from "vitest";

/* The dealer portal's database functions, run in a real Postgres (PGlite) with the minimum shop schema. */
const sql = readFileSync(new URL("../supabase/migrations/20261012120000_dealer_portal.sql", import.meta.url), "utf8")
  .replace(/create extension if not exists pgcrypto with schema extensions;/, "");
let pg: PGlite;
const one = async (q: string, p: any[] = []) => (await pg.query<any>(q, p)).rows[0];
const err = async (q: string, p: any[] = []) => { try { await pg.query(q, p); return ""; } catch (e: any) { return e.message as string; } };

beforeAll(async () => {
  pg = new PGlite({ extensions: { pgcrypto } });
  await pg.exec(`create schema extensions; create extension pgcrypto schema extensions;
    create role anon; create role authenticated;
    create table config(id text primary key, value jsonb, deleted smallint default 0, updated_at timestamptz default now());
    create table products(id uuid primary key, code text, slug text, item text, type text, style text, color text, size text, category text, pack int,
      mrp bigint default 0, rate bigint default 0, wholesale_rate bigint default 0, catalogue smallint default 0, deleted smallint default 0,
      content jsonb, photo_url text, pro_photo_url text, updated_at timestamptz default now());
    create view public_products as select p.id, p.code, p.slug, p.item, p.type, p.style, p.color, p.size, p.category, p.pack, p.mrp,
      coalesce(p.pro_photo_url, p.photo_url) as image_url, p.content, p.updated_at, 5 as available from products p where p.catalogue = 1 and coalesce(p.slug,'') <> '';
    insert into products(id, code, slug, item, style, color, pack, rate, catalogue) values
      ('11111111-1111-4111-8111-111111111111', 'R1', 'set-r1', 'SET', 'K1', 'GOLD', 12, 25000, 1),
      ('22222222-2222-4222-8222-222222222222', 'R2', '', 'SET', 'K2', 'RED', 1, 9000, 0);
    insert into config(id, value) values ('trade_portal', '{"min_order": 300000}');`);
  await pg.exec(sql); await pg.exec(sql);   // idempotent
});
afterAll(async () => { await pg.close(); });

describe("dealer portal", () => {
  let token = "";
  it("registers a dealer as pending; PIN stored only as a hash", async () => {
    expect((await one("select dealer_register('+91 98765 43210','Ravi','Ravi Jewellers','Jaipur','','4321') r")).r).toBe("pending");
    const s = await one("select pin_hash from dealer_secrets");
    expect(s.pin_hash).not.toContain("4321");
    expect(await err("select dealer_register('9876543210','Ravi','','','','1111')")).toMatch(/already registered/);
    expect(await err("select dealer_register('12345','Ravi','','','','1111')")).toMatch(/10-digit/);
  });
  it("can't log in until the shop approves", async () => {
    expect((await one("select dealer_login('9876543210','4321') j")).j.error).toMatch(/not approved/);
    await pg.exec("update dealers set status = 'approved'");
    token = (await one("select dealer_login('9876543210','4321') j")).j.token;
    expect(token).toHaveLength(64);
    expect((await one("select count(*)::int n from dealer_sessions where token_hash = $1", [token])).n).toBe(0); // only the hash is stored
  });
  it("sees only published designs, at trade rates", async () => {
    const rows = (await pg.query<any>("select * from dealer_catalogue($1)", [token])).rows;
    expect(rows.map(r => r.code)).toEqual(["R1"]); expect(Number(rows[0].rate)).toBe(25000);
    expect(await err("select * from dealer_catalogue('nonsense')")).toMatch(/log in/);
  });
  it("orders are priced on the server and must reach the minimum", async () => {
    const forged = JSON.stringify([{ product_id: "11111111-1111-4111-8111-111111111111", qty: 2, rate: 1 }]);
    expect(await err("select dealer_place_order($1, $2::jsonb, '')", [token, forged])).toMatch(/Minimum order/);
    const ok = JSON.stringify([{ product_id: "11111111-1111-4111-8111-111111111111", qty: 12, rate: 1 }]);
    const r = (await one("select dealer_place_order($1, $2::jsonb, 'urgent') j", [token, ok])).j;
    expect(Number(r.total)).toBe(300000); expect(r.no).toMatch(/^TO-\d{6}-0001$/);
    const o = await one("select * from trade_orders");
    expect(o.items[0].rate).toBe(25000); expect(o.dealer_name).toBe("Ravi"); expect(o.status).toBe("new");
  });
  it("refuses unpublished designs, duplicates and silly quantities", async () => {
    const bad = (items: any[]) => err("select dealer_place_order($1, $2::jsonb, '')", [token, JSON.stringify(items)]);
    expect(await bad([{ product_id: "22222222-2222-4222-8222-222222222222", qty: 100 }])).toMatch(/no longer available/);
    expect(await bad([{ product_id: "11111111-1111-4111-8111-111111111111", qty: 0 }])).toMatch(/quantities/);
    expect(await bad([{ product_id: "11111111-1111-4111-8111-111111111111", qty: "x" }])).toMatch(/quantities/);
    expect(await bad([{ product_id: "11111111-1111-4111-8111-111111111111", qty: 20 }, { product_id: "11111111-1111-4111-8111-111111111111", qty: 20 }])).toMatch(/twice/);
  });
  it("locks after 5 wrong PINs", async () => {
    for (let i = 0; i < 5; i++) expect((await one("select dealer_login('9876543210','0000') j")).j.error).toMatch(/Wrong/);
    expect((await one("select dealer_login('9876543210','4321') j")).j.error).toMatch(/wait 15 minutes/);
  });
  it("a blocked dealer's session stops working", async () => {
    await pg.exec("update dealers set status = 'blocked'");
    expect(await err("select dealer_portal_info($1)", [token])).toMatch(/not approved/);
  });
});
