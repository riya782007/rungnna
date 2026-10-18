// Regenerates supabase/migrations/20261012000100_seed_vendors.sql from src/data/vendors.txt
//   npx tsx scripts/gen-vendor-seed.ts
import { readFileSync, writeFileSync } from "node:fs";
import { parseVendorList } from "../src/lib/vendors-parse.js";

const q = (s: string) => "'" + s.replace(/'/g, "''") + "'";
const rows = parseVendorList(readFileSync(new URL("../src/data/vendors.txt", import.meta.url), "utf8"));
const values = rows.map(r => `  (${q(r.code)}, ${q(r.name)}, ${q(r.city)}, ${r.less_pct}, ${r.rate_divisor}, ${q(r.notes)})`).join(",\n");
const sql = `-- Vendor list loaded from src/data/vendors.txt (${rows.length} vendors). Safe to run twice: a vendor code that already exists is left alone.
insert into parties (id, kind, name, city, vendor_code, less_pct, rate_divisor, notes, tier, updated_at)
select gen_random_uuid(), 'supplier', v.name, v.city, v.code, v.less_pct, v.rate_divisor, v.notes, 'wholesale', now()
from (values
${values}
) as v(code, name, city, less_pct, rate_divisor, notes)
where not exists (select 1 from parties p where p.kind = 'supplier' and p.vendor_code = v.code and p.deleted = 0);
`;
writeFileSync(new URL("../supabase/migrations/20261012000100_seed_vendors.sql", import.meta.url), sql);
console.log(rows.length + " vendors written");
