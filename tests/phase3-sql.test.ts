import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

it("applies the migration twice and isolates claimed staff from bank data and other stores", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`create role authenticated; create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.jwt() returns jsonb language sql stable as
        $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
      grant usage on schema auth to authenticated;
      create function public.touch_updated_at() returns trigger language plpgsql as
        $$ begin new.updated_at = now(); return new; end $$;
      create table public.config(id text primary key, value jsonb, updated_at timestamptz);
      alter table public.config enable row level security;
      create policy shop_all on public.config for all to authenticated using(true) with check(true);
      grant all on public.config to authenticated;`);
    for (const table of ["staff", "locations", "movements", "bills", "receipts", "purchases", "purchase_returns", "vouchers"]) {
      await pg.exec(`create table public.${table}(id uuid primary key, updated_at timestamptz default now());
        alter table public.${table} enable row level security;
        create policy shop_all on public.${table} for all to authenticated using(true) with check(true);
        grant all on public.${table} to authenticated;`);
    }
    const sql = readFileSync(new URL("../supabase/migrations/0012_phase3_invock_parity.sql", import.meta.url), "utf8");
    await pg.exec(sql); await pg.exec(sql);
    await pg.exec(`insert into public.stores(id,code,name) values('00000000-0000-4000-8000-00000000b002','B2','Branch');
      insert into public.bills(id) values('00000000-0000-4000-8000-00000000c001');
      insert into public.bills(id,store_id) values('00000000-0000-4000-8000-00000000c002','00000000-0000-4000-8000-00000000b002');
      insert into public.bank_lines(id,account,fingerprint,date,narration,credit,batch) values('00000000-0000-4000-8000-00000000d001','bank','f','2026-10-01','Receipt',100,'batch');
      set role authenticated;
      set request.jwt.claims = '{"app_metadata":{"role":"salesman","store_id":"00000000-0000-4000-8000-00000000b001"}}';`);
    expect((await pg.query("select * from public.bills")).rows).toHaveLength(1);
    expect((await pg.query("select * from public.bank_lines")).rows).toHaveLength(0);
    await expect(pg.exec("insert into public.stores(id,code,name) values('00000000-0000-4000-8000-00000000b003','B3','Denied')")).rejects.toThrow(/row-level security/);
    await pg.exec(`set request.jwt.claims = '{"app_metadata":{"role":"owner"}}'`);
    expect((await pg.query("select * from public.bills")).rows).toHaveLength(2);
    expect((await pg.query("select * from public.bank_lines")).rows).toHaveLength(1);
  } finally { await pg.close(); }
}, 30000);
