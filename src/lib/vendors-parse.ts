/* Pure vendor-list parsing (no database), shared by the app and scripts/gen-vendor-seed.ts. */

export type VendorRow = { code: string; name: string; city: string; less_pct: number; rate_divisor: number; notes: string };

const CITIES: [RegExp, string][] = [[/\bkol\b/i, "Kolkata"], [/\bdaman\b/i, "Daman"], [/\bsrinagar\b/i, "Srinagar"], [/\brohtak\b/i, "Rohtak"]];
const HEADING = /^[A-Za-z][A-Za-z ]*$/; // a line with no code, e.g. JAIPUR, starts a new city group

export function parseVendorList(text: string): VendorRow[] {
  const out: VendorRow[] = []; let group = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line) { group = ""; continue; }    // a blank line ends a city group
    const m = line.match(/^([A-Za-z]?\d+(?:[A-Za-z](?=\s|$))?)\s*[.:)]?\s*(.*)$/);
    if (!m) { if (HEADING.test(line)) group = line.toUpperCase() === line ? line[0] + line.slice(1).toLowerCase() : line; continue; }
    const code = m[1].toUpperCase();
    let name = m[2].replace(/^[-–\s]+/, "").trim();
    if (!name) continue;                       // numbered but still unassigned (14, 21, 29, 64, M2)
    let less = 0, div = 1;
    const l = name.match(/(\d+(?:\.\d+)?)\s*%\s*less/i); if (l) less = Number(l[1]);
    const d = name.match(/(?:rate\s*(?:number)?\s*)?divide\s*(\d+(?:\.\d+)?)/i); if (d) div = Number(d[1]);
    const city = CITIES.find(([re]) => re.test(name))?.[1] || group;
    name = name.replace(/\S*%\s*less/i, "").replace(/(?:rate\s*(?:number)?\s*)?divide\s*\d+(?:\.\d+)?/i, "").replace(/\s+/g, " ").trim() || name;
    out.push({ code, name: name.toUpperCase(), city, less_pct: less, rate_divisor: div, notes: raw.trim() });
  }
  return out;
}
