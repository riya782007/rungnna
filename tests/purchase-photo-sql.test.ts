import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

it("adds the optional purchase payable idempotently without changing goods cost", async () => {
  const pg = new PGlite();
  try {
    await pg.exec("create table public.purchases(id text primary key, total_cost bigint); insert into public.purchases values ('old',10000);");
    const sql = readFileSync(new URL("../supabase/migrations/20261006053516_purchase_invoice_total.sql", import.meta.url), "utf8");
    await pg.exec(sql); await pg.exec(sql);
    expect((await pg.query("select total_cost, invoice_total from public.purchases")).rows).toEqual([{ total_cost: 10000, invoice_total: null }]);
    await pg.exec("update public.purchases set invoice_total=11800;");
    expect((await pg.query("select total_cost, invoice_total from public.purchases")).rows).toEqual([{ total_cost: 10000, invoice_total: 11800 }]);
  } finally { await pg.close(); }
});
