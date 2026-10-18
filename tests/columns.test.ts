import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
// @ts-ignore plain JS helper
import { columnsFromMigrations } from "../scripts/schema-columns.mjs";
import { COLUMNS } from "../src/lib/columns";

it("src/lib/columns.ts matches the migrations (run: node scripts/schema-columns.mjs --write)", () => {
  expect(COLUMNS).toEqual(columnsFromMigrations(fileURLToPath(new URL("../supabase/migrations", import.meta.url))));
});
