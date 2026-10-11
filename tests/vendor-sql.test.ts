import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

const sql = (f: string) => readFileSync(new URL("../supabase/migrations/" + f, import.meta.url), "utf8");

it("adds vendor terms and seeds the vendor list idempotently, without touching existing suppliers", async () => {
  const pg = new PGlite();
  try {
    await pg.exec("create table public.parties(id uuid primary key, kind text, name text, city text default '', notes text default '', tier text, deleted smallint default 0, updated_at timestamptz default now()); insert into public.parties(id,kind,name) values (gen_random_uuid(),'supplier','OLD SUPPLIER');");
    for (const f of ["20261012000000_vendor_terms.sql", "20261012000100_seed_vendors.sql", "20261012000000_vendor_terms.sql", "20261012000100_seed_vendors.sql"]) await pg.exec(sql(f));
    expect((await pg.query("select count(*)::int n from parties")).rows[0]).toEqual({ n: 91 });
    expect((await pg.query("select rate_divisor::float d, less_pct::float l from parties where vendor_code='51'")).rows[0]).toEqual({ d: 1.2, l: 0 });
    expect((await pg.query("select name from parties where vendor_code is null")).rows).toEqual([{ name: "OLD SUPPLIER" }]);
  } finally { await pg.close(); }
});
