import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { distinct, nameItemCode, needsName, DEFAULT_ITEMS, UNITS } from "../lib/products";
import { toast } from "../lib/app";

/* Old labels carry only an item number (202). Ask once per number — name + unit — and every product
   and every future label with that number gets them. Used on Billing and Stock in. */
export function NameItemCodes({ codes, onNamed }: { codes: string[]; onNamed: (code: string, name: string, unit: string) => void }) {
  const [v, setV] = useState<Record<string, { name: string; unit: string }>>({});
  const items = useLiveQuery(() => distinct("item"), [], []);
  if (!codes.length) return null;
  const known = [...new Set([...items.filter(i => !/^ITEM \d+$/.test(i)), ...DEFAULT_ITEMS])];
  const get = (c: string) => v[c] || { name: "", unit: "PCS" };
  const setF = (c: string, patch: Partial<{ name: string; unit: string }>) => setV(x => ({ ...x, [c]: { ...get(c), ...patch } }));
  const hints = (typed: string) => {
    const t = typed.trim().toUpperCase();
    return (t ? known.filter(i => i.includes(t) && i !== t) : known).slice(0, 6);
  };
  return (
    <div className="card pad stack" style={{ borderColor: "#E3CF9E", background: "var(--gold-l)" }}>
      <b className="sm">Name {codes.length > 1 ? "these item numbers" : "this item number"} once</b>
      <datalist id="item-code-names">{known.map(i => <option key={i} value={i} />)}</datalist>
      {codes.map(c => {
        const f = get(c);
        return (
          <form key={c} className="stack" style={{ gap: 6 }} onSubmit={async e => {
            e.preventDefault(); const name = f.name.trim().toUpperCase(); if (!name) return;
            const info = await nameItemCode(c, name, f.unit);
            onNamed(c, info.name, info.unit); toast(`Item ${c} = ${info.name} (${info.unit}) — remembered for every label`);
          }}>
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <span className="mono b" style={{ width: 70 }}>Item {c}</span>
              <input className="in grow" list="item-code-names" placeholder="e.g. F-RING" value={f.name} onChange={e => setF(c, { name: e.target.value.toUpperCase() })} />
              <select className="in" style={{ width: 90 }} aria-label="Unit" value={f.unit} onChange={e => setF(c, { unit: e.target.value })}>
                {UNITS.map(u => <option key={u}>{u}</option>)}</select>
              <button className="btn p">Save</button>
            </div>
            <div className="chips">{hints(f.name).map(h => <button type="button" key={h} className="chip" onClick={() => setF(c, { name: h })}>{h}</button>)}</div>
          </form>);
      })}
    </div>
  );
}

/* item numbers on a list of lines that still have no name ("ITEM 202" or blank with a known code) */
export function unnamedCodes(lines: { item: string; product_id?: string }[], codeOf: (productId?: string) => string | undefined): string[] {
  const out = new Set<string>();
  for (const l of lines) {
    const m = /^ITEM (\d+)$/.exec((l.item || "").trim().toUpperCase());
    if (m) { out.add(m[1]); continue; }
    const c = codeOf(l.product_id);
    if (c && needsName({ item: l.item, item_code: c })) out.add(c);
  }
  return [...out];
}
