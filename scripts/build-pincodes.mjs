/* Builds public/pincodes.txt — every Indian post office with its PIN code, district and GST state code — from the
   India Post directory packaged on npm as india-pincode-lookup@1.0.3 (pincodes.json). Used to find a customer's PIN
   code from the address that was typed (owner, 10 Nov), with no internet needed once loaded.
   Run: npm pack india-pincode-lookup@1.0.3 && tar xzf india-pincode-lookup-1.0.3.tgz && node scripts/build-pincodes.mjs package/pincodes.json */
import fs from "fs";
import { stateCode } from "../src/lib/states.ts";

const rows = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const clean = n => n.trim().replace(/\s+(B\.?O|S\.?O|H\.?O|G\.?P\.?O|SO|BO|HO)\.?(\s*\(.*\))?$/i, "").replace(/\s+/g, " ").trim().toUpperCase();
// the directory predates Telangana (2014) and Ladakh (2019): their PIN codes are listed under the old states
const state = (name, pin) => /^50\d{4}$/.test(pin) ? "36" : /^194\d{3}$/.test(pin) ? "38" : stateCode(name.replace(/CHATTISGARH/, "CHHATTISGARH"));
const districts = [], di = new Map(), seen = new Set(), out = [];
for (const r of rows.sort((a, b) => a.pincode - b.pincode)) {
  const pin = String(r.pincode), name = clean(r.officeName), dist = r.districtName.trim();
  const st = state(r.stateName, pin);
  if (!/^\d{6}$/.test(pin) || !name || !st || name.includes("|")) continue;
  const key = name + "|" + pin; if (seen.has(key)) continue; seen.add(key);
  if (!di.has(dist)) { di.set(dist, districts.length); districts.push(dist); }
  out.push(`${name}|${pin}|${di.get(dist)}|${st}`);
}
fs.writeFileSync("public/pincodes.txt", ["#D|" + districts.join("|"), ...out].join("\n") + "\n");
console.log(out.length, "post offices,", districts.length, "districts");
