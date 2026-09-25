import { useMemo, useRef, useState } from "react";
import { db, put, uid, now, deviceId, type Party, type Product, type Movement, type Config } from "../lib/db";
import { FIELDS, guessMap, parseCSV, findHeader, num, txt, balancePaise, type Kind } from "../lib/importer";
import { blankProduct } from "../lib/products";
import { newParty } from "../lib/billing";
import { useApp, toast, go } from "../lib/app";
import { toPaise } from "../lib/format";
import { Head, LocationSelect } from "../components/common";
import { Icon } from "../components/Icon";

/* Import from the old software: export its item list / party list to Excel or CSV, drop it here. */
export default function Import() {
  const { me } = useApp();
  const [kind, setKind] = useState<Kind>("products");
  const [rows, setRows] = useState<string[][]>([]);
  const [head, setHead] = useState(0);
  const [map, setMap] = useState<Record<string, number>>({});
  const [loc, setLoc] = useState("");
  const [file, setFile] = useState("");
  const [busy, setBusy] = useState("");
  const [done, setDone] = useState("");
  const inp = useRef<HTMLInputElement>(null);

  async function load(f: File, k = kind) {
    setDone(""); setFile(f.name);
    let data: string[][];
    if (/\.xlsx$/i.test(f.name)) {
      const { readSheet } = await import("read-excel-file/browser");
      data = (await readSheet(f)).map(r => r.map(c => (c instanceof Date ? c.toISOString().slice(0, 10) : c == null ? "" : String(c))));
    } else if (/\.(csv|txt)$/i.test(f.name)) data = parseCSV(await f.text());
    else { toast("Please save the file as .xlsx or .csv first (old .xls: open in Excel → Save As → .xlsx)", true); return; }
    const h = findHeader(data, k);
    setRows(data); setHead(h); setMap(guessMap(data[h] || [], k));
  }
  const headers = rows[head] || [];
  const body = useMemo(() => rows.slice(head + 1).filter(r => r.some(c => txt(c))), [rows, head]);
  const val = (r: string[], k: string) => (map[k] !== undefined ? r[map[k]] : "");
  const itemOnly = kind === "products" && map.style === undefined && map.item_code !== undefined && map.item !== undefined;

  async function run() {
    if (!body.length) return;
    setBusy("Importing…");
    try {
      if (kind === "parties") {
        const existing = await db.parties.toArray();
        let added = 0, updated = 0;
        for (const r of body) {
          const name = txt(val(r, "name")).toUpperCase(); if (!name) continue;
          const phone = txt(val(r, "phone")).replace(/\D/g, "").slice(-10);
          const old = existing.find(p => (phone && p.phone === phone) || p.name === name);
          const p: Party = { ...(old || newParty(name, phone)), name, phone: phone || old?.phone || "",
            city: txt(val(r, "city")) || old?.city || "", state: txt(val(r, "state")) || old?.state || "", gstin: txt(val(r, "gstin")).toUpperCase() || old?.gstin || "",
            address: txt(val(r, "address")) || old?.address || "" };
          if (map.opening_balance !== undefined) p.opening_balance = balancePaise(val(r, "opening_balance"));
          await put("parties", p); old ? updated++ : added++;
        }
        setDone(`${added} customers added, ${updated} updated.`);
      } else if (itemOnly) {
        const cur = ((await db.config.get("item_codes"))?.value || {}) as Record<string, string>;
        let n = 0;
        for (const r of body) { const c = txt(val(r, "item_code")), nm = txt(val(r, "item")).toUpperCase(); if (c && nm) { cur[c] = nm; n++; } }
        await put("config", { id: "item_codes", value: cur, updated_at: now() } as Config);
        setDone(`${n} item names learnt. Every label with these item codes now fills its name by itself.`);
      } else {
        const all = await db.products.toArray();
        const key = (p: { style: string; color: string; item_code?: string }) => (p.style ? p.style + "|" + p.color : "#" + (p.item_code || ""));
        const idx = new Map(all.filter(p => !p.deleted).map(p => [key(p), p]));
        let added = 0, updated = 0, pcs = 0;
        for (let i = 0; i < body.length; i += 200) {
          setBusy(`Importing ${Math.min(i + 200, body.length)} of ${body.length}…`);
          await db.transaction("rw", [db.products, db.movements, db.outbox, db.stock], async () => {
            for (const r of body.slice(i, i + 200)) {
              const style = txt(val(r, "style")).toUpperCase(), color = txt(val(r, "color")).toUpperCase(), item = txt(val(r, "item")).toUpperCase();
              const item_code = txt(val(r, "item_code"));
              if (!style && !item && !item_code) continue;
              const old = idx.get(key({ style, color, item_code }));
              const p: Product = { ...(old || blankProduct(me?.id || "")), style: style || old?.style || "", color: color || old?.color || "", item: item || old?.item || "",
                item_code: item_code || old?.item_code, category: txt(val(r, "category")) || old?.category || "" };
              if (map.rate !== undefined && num(val(r, "rate"))) p.rate = toPaise(num(val(r, "rate")));
              if (map.mrp !== undefined && num(val(r, "mrp"))) p.mrp = toPaise(num(val(r, "mrp")));
              if (map.cost !== undefined && num(val(r, "cost"))) p.cost = toPaise(num(val(r, "cost")));
              if (map.pack !== undefined && num(val(r, "pack")) > 1) p.pack = Math.round(num(val(r, "pack")));
              if (map.tk !== undefined) p.tk = txt(val(r, "tk")) ? "TK" : "";
              if (!p.barcodes.includes(p.code)) p.barcodes = [...p.barcodes, p.code];
              await put("products", p); idx.set(key(p), p); old ? updated++ : added++;
              const q = Math.round(num(val(r, "qty")));
              if (loc && q > 0) {
                const m: Movement = { id: uid(), product_id: p.id, kind: "intake", qty: q, from_loc: null, to_loc: loc, person_type: "owner", person_name: "Opening stock",
                  by_staff: me?.id || "", note: "Imported from " + file, device: deviceId(), at: now(), updated_at: now() };
                await put("movements", m);
                const k = p.id + "|" + loc; const c = await db.stock.get(k); await db.stock.put({ key: k, product_id: p.id, loc_id: loc, qty: (c?.qty || 0) + q });
                pcs += q;
              }
            }
          });
        }
        setDone(`${added} products added, ${updated} updated${pcs ? `, ${pcs.toLocaleString("en-IN")} pieces placed as opening stock` : ""}.`);
      }
      toast("Import finished");
    } catch (e: any) { toast(e.message || "Import failed", true); } finally { setBusy(""); }
  }

  return (
    <div>
      <Head title="Import" sub="Bring your item list, customers and stock from the old software. Export them to Excel or CSV there, then drop the file here." />
      <div className="card pad stack" style={{ marginBottom: 14 }}>
        <div className="seg">{(["products", "parties"] as const).map(k => <button key={k} aria-pressed={kind === k} onClick={() => { setKind(k); setRows([]); setMap({}); setDone(""); }}>{k === "products" ? "Items & stock" : "Customers & balances"}</button>)}</div>
        <input ref={inp} type="file" accept=".xlsx,.csv,.txt" hidden onChange={e => { const f = e.target.files?.[0]; if (f) load(f); e.target.value = ""; }} />
        <button className="btn big" onClick={() => inp.current?.click()}><Icon n="plus" size={18} />{file ? "Choose another file" : "Choose Excel / CSV file"}</button>
        {file && <div className="sm mut">{file} · {body.length} rows found</div>}
      </div>

      {rows.length > 0 && <div className="split">
        <div className="card pad stack">
          <b>Match the columns</b>
          <div className="xs mut">I've guessed from the column names — check each one.</div>
          <div className="grid g2">
            {FIELDS[kind].map(f => (
              <label key={f.key} className="f">{f.label}
                <select className="in" value={map[f.key] ?? ""} onChange={e => setMap(m => { const n = { ...m }; if (e.target.value === "") delete n[f.key]; else n[f.key] = Number(e.target.value); return n; })}>
                  <option value="">— not in file —</option>{headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}</select></label>))}
          </div>
          {kind === "products" && map.qty !== undefined && !itemOnly && <LocationSelect value={loc} onChange={setLoc} label="Put the stock quantities into (leave empty to skip stock)" buckets={false} allowNone="Don't add stock" />}
          {itemOnly && <div className="note sm">This looks like an item list (code → name) without styles. It will teach the app names like 202 = F-RING, so scanned labels fill their item name by themselves.</div>}
          {kind === "parties" && map.opening_balance !== undefined && <div className="note warn sm">Balances become each customer's opening balance (Dr = they owe you, Cr = advance). Import this once only.</div>}
          <button className="btn p big" disabled={!!busy || !body.length} onClick={run}>{busy || `Import ${body.length} rows`}</button>
          {done && <div className="note">{done} <a href={kind === "parties" ? "#/customers" : "#/products"} onClick={() => go(kind === "parties" ? "customers" : "products")}>Open list →</a></div>}
        </div>
        <div className="card tw"><table>
          <thead><tr>{FIELDS[kind].filter(f => map[f.key] !== undefined).map(f => <th key={f.key}>{f.label}</th>)}</tr></thead>
          <tbody>{body.slice(0, 12).map((r, i) => <tr key={i}>{FIELDS[kind].filter(f => map[f.key] !== undefined).map(f => <td key={f.key} className="sm">{r[map[f.key]]}</td>)}</tr>)}</tbody>
        </table>{body.length > 12 && <div className="xs mut pad">…and {body.length - 12} more rows</div>}</div>
      </div>}
    </div>
  );
}
