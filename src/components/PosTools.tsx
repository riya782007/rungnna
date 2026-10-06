import { useMemo, useRef, useState } from "react";
import { Plus, Calculator, Delete, RotateCcw } from "lucide-react";
import { Modal } from "./common";
import { type BillLine, type Product } from "../lib/db";
import { manualLine, moneyInput } from "../lib/pos";
import { calculate } from "../lib/calculator";
import { priceFor } from "../lib/billing";
import { fillFromItemCode } from "../lib/products";
import { rupees } from "../lib/format";

export function ManualItems({ products, box, level, canRates, onProduct, onCustom, onClose, inline = false }: {
  products: Product[]; box: number; level: "wholesale" | "retail" | "dealer"; canRates: boolean;
  onProduct: (p: Product, count: number, pieces: boolean, rate: number) => void;
  onCustom: (l: BillLine) => void; onClose: () => void; inline?: boolean;
}) {
  const [mode, setMode] = useState("custom"), [q, setQ] = useState(""), [chosen, setChosen] = useState<Product | null>(null);
  const [qty, setQty] = useState("1"), [pieces, setPieces] = useState(false), [rate, setRate] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [item, setItem] = useState(""), [style, setStyle] = useState(""), [color, setColor] = useState(""), [unit, setUnit] = useState("PCS"), [hsn, setHsn] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => { const words = q.trim().toUpperCase().split(/\s+/); return products.filter(p => words.every(w => [p.item, p.item_code, p.code, p.style, p.color].join(" ").toUpperCase().includes(w))).slice(0, 30); }, [q, products]);
  const select = async (p: Product) => { setBusy(true); setError(""); try { const named = await fillFromItemCode(p); setChosen(named); setRate(String(priceFor(named, level) / 100)); setQty("1"); } catch (e: any) { setError(e.message); } finally { setBusy(false); } };
  const submit = (next: boolean) => {
    try {
      if (mode === "custom") onCustom(manualLine({ item, style, color, unit, hsn, qty, rate, box }));
      else {
        if (!chosen) throw new Error("Select a product");
        const count = Number(qty); if (!Number.isSafeInteger(count) || count <= 0 || count > 1000000) throw new Error("Enter a positive whole quantity");
        onProduct(chosen, count, pieces, canRates || !priceFor(chosen, level) ? moneyInput(rate) : priceFor(chosen, level));
      }
      if (!next) return onClose();
      setChosen(null); setQ(""); setItem(""); setRate(""); setQty("1"); setStyle(""); setColor(""); setError(""); search.current?.focus();
    } catch (e: any) { setError(e.message); }
  };
  const content = <div className="stack pos-tools">
    <div className="seg" role="group" aria-label="Item source"><button aria-pressed={mode === "catalog"} onClick={() => { setMode("catalog"); setError(""); }}>Stock item</button><button aria-pressed={mode === "custom"} onClick={() => { setMode("custom"); setRate(""); setError(""); }}>Custom item</button></div>
    {mode === "catalog" ? <><label className="f">Search products<input className="in" autoFocus ref={search} value={q} onChange={e => { setQ(e.target.value); setChosen(null); }} placeholder="Name, item number, style or colour" /></label>
      {!chosen ? <div className="pos-picklist">{hits.map(p => <button className="pos-pick" key={p.id} disabled={busy} onClick={() => select(p)}><span><b>{p.item || "Item " + (p.item_code || p.code)}</b><span className="mut sm">{p.style} · {p.color}</span></span><b className="mono">{rupees(priceFor(p, level))}</b></button>)}{!hits.length && <div className="mut">No matching products</div>}</div> : <div className="note"><b>{chosen.item || "Item " + chosen.item_code}</b><div>{chosen.style} · {chosen.color} · {chosen.type}</div></div>}
    </> : <div className="grid g2"><label className="f">Product name<input ref={search} autoFocus className="in" value={item} onChange={e => setItem(e.target.value)} /></label><label className="f">Unit<select className="in" value={unit} onChange={e => setUnit(e.target.value)}>{["PCS", "PAIR", "SET"].map(u => <option key={u}>{u}</option>)}</select></label><label className="f">Style<input className="in" value={style} onChange={e => setStyle(e.target.value)} /></label><label className="f">Colour<input className="in" value={color} onChange={e => setColor(e.target.value)} /></label><label className="f">HSN<input className="in" inputMode="numeric" value={hsn} onChange={e => setHsn(e.target.value)} /></label><span className="pill">Custom · no stock movement</span></div>}
    {(chosen || mode === "custom") && <form onSubmit={e => { e.preventDefault(); submit(false); }} className="stack">
      {chosen && (chosen.pack || 1) > 1 && <div className="seg" role="group" aria-label="Quantity mode"><button type="button" aria-pressed={!pieces} onClick={() => setPieces(false)}>Packets ×{chosen.pack}</button><button type="button" aria-pressed={pieces} onClick={() => setPieces(true)}>Loose {chosen.type}</button></div>}
      <div className="grid g2"><label className="f">Quantity<input className="in" type="number" min={1} step={1} value={qty} onChange={e => setQty(e.target.value)} /></label><label className="f">Rate ₹ / {chosen?.type || unit}<input className="in" inputMode="decimal" value={rate} disabled={!!chosen && !canRates && !!priceFor(chosen, level)} onChange={e => setRate(e.target.value)} /></label></div>
      <div className="row"><button className="btn p" disabled={busy}><Plus size={16} />Add to bill</button><button type="button" className="btn" disabled={busy} onClick={() => submit(true)}>Add & next</button></div>
    </form>}
    {error && <div role="alert" className="note warn">{error}</div>}
  </div>;
  return inline ? <section className="pos-inline" aria-label="Add item"><div className="row"><b className="grow">ITEM</b><button className="x" aria-label="Close item entry" onClick={onClose}>×</button></div>{content}</section> : <Modal title="Add items manually" onClose={onClose}>{content}</Modal>;
}

export type CalcTarget = "none" | "rate" | "packing" | "discount";
export function PosCalculator({ lines, onApply, onClose }: { lines: BillLine[]; onApply: (value: number, target: CalcTarget, line: string) => void; onClose: () => void }) {
  const [expression, setExpression] = useState(""), [result, setResult] = useState("0"), [error, setError] = useState(""), [target, setTarget] = useState<CalcTarget>("none"), [line, setLine] = useState(lines[lines.length - 1]?.id || "");
  const [history, setHistory] = useState<string[]>([]);
  const equals = () => { try { const value = calculate(expression); setResult(value); setHistory(h => [expression + " = " + value, ...h].slice(0, 4)); setError(""); return value; } catch (e: any) { setError(e.message); return null; } };
  const press = (key: string) => { setError(""); if (key === "=") equals(); else if (key === "C") { setExpression(""); setResult("0"); } else if (key === "DEL") setExpression(x => x.slice(0, -1)); else setExpression(x => x + (key === "%" ? "/100" : key)); };
  return <Modal title="POS calculator" onClose={onClose}><div className="stack pos-tools">
    <label className="f">Calculation<input className="in mono" autoFocus value={expression} onChange={e => setExpression(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); equals(); } }} /></label>
    <output className="pos-calc-result mono" aria-live="polite">{result}</output>
    <div className="pos-keypad">{["C", "(", ")", "DEL", "7", "8", "9", "÷", "4", "5", "6", "×", "1", "2", "3", "-", "0", ".", "%", "+", "="].map(key => <button key={key} className={"btn " + (key === "=" ? "p" : "")} title={key === "DEL" ? "Backspace" : key === "C" ? "Clear" : key} aria-label={key === "DEL" ? "Backspace" : key === "C" ? "Clear" : key} onClick={() => press(key)}>{key === "DEL" ? <Delete size={18} /> : key === "C" ? <RotateCcw size={18} /> : key}</button>)}</div>
    <label className="f">Use result for<select className="in" value={target} onChange={e => setTarget(e.target.value as CalcTarget)}><option value="none">Calculation only</option><option value="rate">Item rate</option><option value="packing">Packing ₹</option><option value="discount">Bill discount ₹</option></select></label>
    {target === "rate" && <label className="f">Bill item<select className="in" value={line} onChange={e => setLine(e.target.value)}>{lines.map((l, i) => <option key={l.id} value={l.id}>{i + 1}. {l.item} · {l.style}</option>)}</select></label>}
    {target !== "none" && <button className="btn p" disabled={target === "rate" && !line} onClick={() => { const value = equals(); if (value !== null) try { onApply(moneyInput(Number(value).toFixed(2)), target, line); onClose(); } catch (e: any) { setError(e.message); } }}><Calculator size={16} />Apply result</button>}
    {error && <div role="alert" className="note warn">{error}</div>}
    {history.length > 0 && <div className="pos-calc-history mono sm">{history.map((h, i) => <div key={i}>{h}</div>)}</div>}
  </div></Modal>;
}
