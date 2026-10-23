import { currentStore } from "../lib/scope";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, put, now, getSetting, setSetting, type Party, type Product } from "../lib/db";
import { toast } from "../lib/app";
import { rupees, toPaise, when } from "../lib/format";
import { getRule, saveRule, validateKey, priceSteps, costCode, DEFAULT_RULE, type PricingRule, type RoundTo } from "../lib/pricing";
import { blankProduct } from "../lib/products";
import { DEFAULT_CFG, LabelView, loadLabelCfg, type LabelCfg } from "../pages/Labels";
import { rateMark } from "../lib/label-tspl";
import { saveLabelPatch } from "./StickerQuickBar";
import { printedCostCode } from "../lib/label-cost-code";
import { byRollNo } from "./SupplierNo";
import { RECEIPT_CUTS, receiptCut, receiptCutSetup, type ReceiptCut } from "../lib/printing";
import { gstRequest } from "../lib/compliance";
import { getShop, saveShop } from "../lib/billing";

/* ===========================================================================
   Settings the owner works with himself (owner, 18 Oct: "he must be able to customise it, everything well
   visible and well informed"). Every card says in plain words what it changes, shows the result before it
   is saved, and says clearly — in green — once it is saved, or in amber while a change is not saved yet.
=========================================================================== */

/** One field with its explanation underneath. */
export function Help({ label, help, children, wide }: { label: ReactNode; help?: ReactNode; children: ReactNode; wide?: boolean }) {
  return <label className="f set-field" style={wide ? { gridColumn: "1/-1" } : undefined}>{label}{children}{help && <span className="set-help">{help}</span>}</label>;
}
/** The saved / not-saved signal in a card's header. */
export function SaveState({ dirty, savedAt }: { dirty: boolean; savedAt?: string }) {
  return dirty ? <span className="pill warn">● not saved yet</span>
    : <span className="pill ok">✓ saved{savedAt ? " " + when(savedAt) : ""}</span>;
}

const r1 = (p: number) => rupees(p).replace(/\.00$/, "");

export function PricingCard() {
  const [rule, setRule] = useState<PricingRule>(DEFAULT_RULE);
  const company = useLiveQuery(() => db.stores.get(currentStore()), []);
  const [saved, setSaved] = useState<PricingRule>(DEFAULT_RULE);
  const [sample, setSample] = useState("120");   // ₹ cost to try
  const [pack, setPack] = useState("1");
  const [keyErr, setKeyErr] = useState<string | null>(null);
  const [cfg, setCfg] = useState<LabelCfg>(DEFAULT_CFG);
  const [justSaved, setJustSaved] = useState(false);
  useEffect(() => { getRule().then(r => { setRule(r); setSaved(r); setKeyErr(validateKey(r.code.key)); }); loadLabelCfg().then(setCfg); }, []);

  const m = rule.margin, c = rule.code;
  const setM = (patch: Partial<PricingRule["margin"]>) => { setJustSaved(false); setRule(r => ({ ...r, margin: { ...r.margin, ...patch } })); };
  const setC = (patch: Partial<PricingRule["code"]>) => { setJustSaved(false); setRule(r => ({ ...r, code: { ...r.code, ...patch } })); };
  const strip = (r: PricingRule) => JSON.stringify({ ...r, updated_at: undefined, even_rate: r.even_rate !== false });
  const dirty = strip(rule) !== strip(saved);

  const cost = toPaise(sample) || 0, pk = Math.max(1, Math.floor(Number(pack)) || 1);
  const steps = cost > 0 ? priceSteps(cost, rule) : null;
  const code = cost > 0 && !(c.method === "letters" && keyErr) ? costCode(cost, rule, pk, "PCS") : "";
  const sampleProduct: Product = useMemo(() => ({ ...blankProduct(""), item: "EARRINGS", style: "K5210", color: "", type: "PCS", rate: steps?.final || 0, cost, cost_code: code, pack: pk }), [steps?.final, cost, code, pk]);

  const save = async () => {
    const err = c.method === "letters" ? validateKey(c.key) : null;
    if (err) { setKeyErr(err); toast(err, true); return; }
    try { const r = await saveRule(rule); setRule(r); setSaved(r); setJustSaved(true); toast("Pricing saved — every counter now prices this way"); }
    catch (e: any) { toast(e.message, true); }
  };
  const how = m.mode === "percent" ? `+ ${m.percent}%` : `${m.mode === "divide" ? "÷" : "×"} ${m.factor}`;

  return (
    <div className="card"><header><h3>Selling price &amp; cost code</h3><span className="grow" /><SaveState dirty={dirty} savedAt={saved.updated_at} /></header>
      <div className="pad stack">
        <div className="set-intro">When a cost is typed (Labels screen, purchase bill reader), the selling rate and the secret cost code on the sticker are worked out from these rules. One change here reaches every counter.</div>
        {company && company.kind && <div className="note sm">These rules are for <b>{company.name}</b> only — each company keeps its own profit margin. Switch the company in the menu to set the other one.</div>}

        <div className="set-sub">1 · From cost to selling rate</div>
        <div className="grid g2">
          <Help label="Selling rate is the cost" help="How the rate is worked out from what you paid the supplier.">
            <select className="in" value={m.mode} onChange={e => setM({ mode: e.target.value as any })}>
              <option value="multiply">× a factor</option>
              <option value="divide">÷ a factor</option>
              <option value="percent">+ a percent markup</option>
            </select></Help>
          {m.mode === "percent"
            ? <Help label="Markup %" help={`150 means a ₹100 cost sells at ₹250.`}><NumberText value={m.percent} fallback={0} onValue={v => setM({ percent: v })} /></Help>
            : <Help label="Factor" help={m.mode === "divide" ? "0.4 means a ₹100 cost sells at ₹250." : `${m.factor || 2.5} means a ₹100 cost sells at ₹${Math.round(100 * (m.factor || 2.5))}.`}>
                <NumberText value={m.factor} fallback={0} onValue={v => setM({ factor: v })} /></Help>}
          <Help label="Round the rate to" help="So rates look like shop rates (₹245, not ₹243.75).">
            <select className="in" value={m.round_to} onChange={e => setM({ round_to: Number(e.target.value) as RoundTo })}>
              <option value={0}>Exact (paise)</option><option value={1}>₹1</option><option value={5}>₹5</option>
              <option value={10}>₹10</option><option value={50}>₹50</option><option value={100}>₹100</option>
            </select></Help>
          <Help label="Rounding" help={m.round_dir === "up" ? `Always up: ₹243 → ₹${m.round_to ? Math.ceil(243 / m.round_to) * m.round_to : 243}.` : `Nearest: ₹243 → ₹${m.round_to ? Math.round(243 / m.round_to) * m.round_to : 243}.`}>
            <select className="in" value={m.round_dir} onChange={e => setM({ round_dir: e.target.value as any })}>
              <option value="nearest">Nearest</option><option value="up">Always up</option>
            </select></Help>
        </div>
        <label className="set-switch"><input type="checkbox" checked={rule.even_rate !== false} onChange={e => { setJustSaved(false); setRule(r => ({ ...r, even_rate: e.target.checked })); }} />
          <span><b>Sticker rates are always even</b><span className="set-help">975 → 976, so half the rate (the wholesale rate) never has 50 paise. Applies to every sticker printed.</span></span></label>

        <div className="grid g2">
          <Help label="Retail rate = sticker rate +" help={rule.retail_pct ? `${rule.retail_pct}% means a ₹200 sticker rate is ₹${Math.ceil(200 * (1 + rule.retail_pct / 100))} for retail customers.` : "0 means retail customers pay the sticker rate. Type e.g. 20 for 20% more."}>
            <NumberText value={rule.retail_pct || 0} fallback={0} onValue={v => { setJustSaved(false); setRule(r => ({ ...r, retail_pct: Math.max(0, v) })); }} /></Help>
          <div className="set-help" style={{ alignSelf: "end" }}>Used for new products (Add inventory, purchase bills) when the retail rate is left blank, and on bills for retail customers.</div>
        </div>

        <div className="set-sub">2 · How the cost is hidden on the sticker</div>
        <div className="grid g2">
          <Help label="Hide the cost as" help={c.method === "letters" ? "Each digit of the cost becomes a letter of your code word." : c.method === "shift" ? "The cost is multiplied and added to, so only you can read it." : "The cost prints as it is — anyone can read it."}>
            <select className="in" value={c.method} onChange={e => { setC({ method: e.target.value as any }); setKeyErr(e.target.value === "letters" || e.target.value === "shift_letters" ? validateKey(c.key) : null); }}>
              <option value="letters">Code word (letters)</option>
              <option value="shift">Maths shift (× / +)</option>
              <option value="shift_letters">Maths shift, then code word letters</option>
              <option value="plain">Plain number (no hiding)</option>
            </select></Help>
          <Help label="Letters before the code (optional)" help={c.prefix ? `Every code starts with “${c.prefix}”.` : "Leave empty if you don't want any."}>
            <input className="in mono" value={c.prefix} maxLength={4} onChange={e => setC({ prefix: e.target.value.toUpperCase() })} /></Help>
          {(c.method === "letters" || c.method === "shift_letters") && (
            <Help wide label="Secret code word — 10 different letters, one for each digit 0 to 9" help={keyErr ? <span className="bad">{keyErr}</span> : undefined}>
              <input className={"in mono" + (keyErr ? " bad" : "")} value={c.key} maxLength={10}
                onChange={e => { const k = e.target.value.toUpperCase().replace(/[^A-Z]/g, ""); setC({ key: k }); setKeyErr(validateKey(k)); }} />
              {!keyErr && <span className="set-key">{c.key.split("").map((ch, i) => <span key={i}><small>{i}</small>{ch}</span>)}</span>}
            </Help>
          )}
          {(c.method === "shift" || c.method === "shift_letters") && <>
            <Help label="Multiply the cost by" help={`e.g. 2 doubles it, 1.5 adds half. ₹100 → ${Math.round(100 * (c.mult || 1) + (c.add || 0))}`}><NumberText value={c.mult} fallback={1} onValue={v => setC({ mult: v })} /></Help>
            <Help label="Then add" help="e.g. 7 — or 0 for nothing. A minus works too."><NumberText value={c.add} fallback={0} onValue={v => setC({ add: v })} /></Help>
          </>}
        </div>
        {/* moved here from printer settings (owner, 22 Oct: "printer settings only for the machine") */}
        {cfg && <div className="grid g2">
          <label className="set-switch"><input type="checkbox" checked={!!cfg.compactCostCode} onChange={async e => setCfg(await saveLabelPatch(cfg, { compactCostCode: e.target.checked }))} />
            <span><b>Compact repeated letters</b><span className="set-help">A letter that repeats prints as a dash (RPP → RP-).</span></span></label>
          <Help label="Fake letters mixed in" help="Any letters A–Z; one is mixed into each sticker's code so it can't be read. Empty = none.">
            <input className="in mono" value={cfg.fakeLetters ?? "Z"} placeholder="e.g. ZYAB" onChange={async e => setCfg(await saveLabelPatch(cfg, { fakeLetters: e.target.value.toUpperCase().replace(/[^A-Z]/g, "") }))} /></Help>
          <div className="sm mono" aria-label="Cost code examples">{[0, 1, 2].map(i => printedCostCode("RPPX1PCS", cfg, i)).join(" · ")}</div>
        </div>}
        <label className="set-switch"><input type="checkbox" checked={c.suffix_pack} onChange={e => setC({ suffix_pack: e.target.checked })} />
          <span><b>Add the packing after the code</b><span className="set-help">e.g. RPPX1PCS — X1 means one piece, X12 a packet of twelve.</span></span></label>

        <div className="set-sub">3 · Try it before saving</div>
        <div className="set-try">
          <div className="row" style={{ gap: 10, alignItems: "end" }}>
            <Help label="A cost ₹"><input className="in mono" style={{ width: 110 }} inputMode="decimal" value={sample} onChange={e => setSample(e.target.value)} /></Help>
            <Help label="Pieces per packet"><input className="in mono" style={{ width: 90 }} inputMode="numeric" value={pack} onChange={e => setPack(e.target.value)} /></Help>
          </div>
          {steps && steps.final > 0 ? <>
            <ol className="set-steps">
              <li>Cost <b>{r1(cost)}</b> {how} = <b>{rupees(steps.raw)}</b></li>
              <li>Rounded ({m.round_to ? `₹${m.round_to}, ${m.round_dir === "up" ? "always up" : "nearest"}` : "exact"}) = <b>{r1(steps.rounded)}</b></li>
              {rule.even_rate !== false && <li>Even rate = <b>{r1(steps.final)}</b>{steps.final !== steps.rounded ? " (one rupee more)" : " (already even)"} · wholesale half = {r1(steps.final / 2)}</li>}
              <li>Cost code on the sticker = <b className="mono">{code || "—"}</b></li>
            </ol>
            <div className="row" style={{ gap: 14, alignItems: "center" }}>
              <div className="label-preview" style={{ padding: 8 }}><LabelView cfg={cfg} p={sampleProduct} qtyOnLabel={pk} line={1} /></div>
              <span className="xs mut">This is the sticker as it will print ({cfg.w}×{cfg.h} mm, “{rateMark(cfg)}” before the rate).</span>
            </div>
          </> : <div className="xs mut">{c.method === "letters" && keyErr ? "Fix the code word to see the result." : "Type a cost to see the result."}</div>}
        </div>

        <div className="row">
          <button className={"btn" + (dirty ? " p" : "")} onClick={save} disabled={(c.method === "letters" && !!keyErr) || !dirty}>{dirty ? "Save pricing" : "Saved"}</button>
          {dirty && <button className="linkbtn" onClick={() => { setRule(saved); setKeyErr(validateKey(saved.code.key)); }}>Undo my changes</button>}
        </div>
        {justSaved && !dirty && <div className="note ok applied-note sm" role="status">✓ Saved. Every counter prices this way from now on; stickers already printed keep their old rate.</div>}
        <div className="xs mut">The code word is the whole secret: anyone who knows it can read a cost off a sticker. Share it only with people you trust, and change it here if it ever leaks.</div>
      </div></div>
  );
}

/* What his stickers look like on this computer, and where to change it. */
export function StickerLookCard() {
  const [cfg, setCfg] = useState<LabelCfg | null>(null);
  useEffect(() => { loadLabelCfg().then(setCfg); }, []);
  if (!cfg) return null;
  const shown = Object.entries({ item: "Item", style: "Style", color: "Colour", cost_code: "Cost code", line: "Line no.", rate: "Rate", qty: "X packing", shop: "Shop name", code: "Barcode no.", tk: "TK" })
    .filter(([k]) => (cfg.show as any)[k] ?? (k === "line")).map(([, v]) => v);
  const p = { ...blankProduct(""), item: "BAHUBALI", style: "6061", color: "K5210/2T", type: "PCS", rate: 25000, cost_code: "RPPX1PCS", pack: 1 } as Product;
  return (
    <div className="card"><header><h3>Stickers on this computer</h3></header>
      <div className="pad stack">
        <div className="label-preview" style={{ padding: 8, alignSelf: "flex-start" }}><LabelView cfg={cfg} p={p} qtyOnLabel={1} line={1} /></div>
        <dl className="set-dl">
          <dt>Sticker size</dt><dd>{cfg.w} × {cfg.h} mm{cfg.mode === "roll" ? " · roll" : " · sheet"}</dd>
          <dt>Before the rate</dt><dd>“{rateMark(cfg)}”</dd>
          <dt>Printed on it</dt><dd>{shown.join(" · ")}</dd>
          <dt>Printer</dt><dd>{cfg.output === "tspl" ? "Straight to the TSC printer" : "Through the browser print window"}</dd>
        </dl>
        <a className="btn" href="#/labels">Change sticker size, layout or printer →</a>
        <div className="xs mut">These are kept per computer, because each counter's printer is set up on its own. Open Labels → Printer settings on the computer that prints.</div>
      </div></div>
  );
}

/* Every supplier's terms in one list: rate ÷ and less %, used by "Apply vendor terms" in the bill reader. */
export function SupplierTermsCard() {
  const suppliers = useLiveQuery(() => db.parties.filter(p => !p.deleted && p.kind === "supplier").toArray(), [], []);
  const [q, setQ] = useState("");
  const list = useMemo(() => [...suppliers].sort(byRollNo).filter(s => !q.trim() || [s.vendor_code, s.name, s.city].join(" ").toLowerCase().includes(q.trim().toLowerCase())), [suppliers, q]);
  return (
    <div className="card set-wide"><header><h3>Supplier terms</h3><span className="grow" /><span className="pill">{suppliers.length} suppliers</span></header>
      <div className="pad stack">
        <div className="set-intro">
          Used by <b>Apply vendor terms</b> when a supplier's bill is read. <b>Rate ÷ 1.2</b>: the bill says ₹120, it really costs ₹100. <b>Less 5%</b>: ₹100 becomes ₹95.
          Press <i>Apply vendor terms</i> once per bill; it shows a green tick when done and won't divide twice.
        </div>
        <input className="in" placeholder="Find by roll no. or name" value={q} onChange={e => setQ(e.target.value)} />
        <div className="set-terms">
          <div className="set-terms-h"><span>Roll no.</span><span>Supplier</span><span>Rate ÷</span><span>Less %</span><span /></div>
          {list.slice(0, 200).map(s => <TermsRow key={s.id} p={s} />)}
          {!list.length && <div className="xs mut" style={{ padding: 8 }}>{suppliers.length ? "No supplier matches." : "No suppliers yet. Add them on the Suppliers page."}</div>}
        </div>
        <a className="btn" href="#/suppliers">Open the Suppliers page →</a>
      </div></div>
  );
}
function TermsRow({ p }: { p: Party }) {
  const [div, setDiv] = useState(String(p.rate_divisor || 1)), [less, setLess] = useState(String(p.less_pct || 0));
  const [ok, setOk] = useState(false);
  useEffect(() => { setDiv(String(p.rate_divisor || 1)); setLess(String(p.less_pct || 0)); }, [p.updated_at]);
  const d = Number(div), l = Number(less), bad = !(d > 0 && d <= 10) || !(l >= 0 && l < 100);
  const dirty = d !== (p.rate_divisor || 1) || l !== (p.less_pct || 0);
  const save = async () => {
    if (bad) return toast("Rate ÷ must be between 0 and 10, less % between 0 and 99", true);
    await put("parties", { ...p, rate_divisor: d, less_pct: l, updated_at: now() }); setOk(true); toast(`${p.vendor_code || p.name}: terms saved`);
  };
  return (
    <div className={"set-terms-r" + (dirty ? " dirty" : "")}>
      <span className="mono b">{p.vendor_code || "—"}</span>
      <span className="sm" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
      <input className={"in mono" + (bad ? " bad" : "")} inputMode="decimal" aria-label={`Rate divisor ${p.name}`} value={div} onChange={e => { setOk(false); setDiv(e.target.value); }} onKeyDown={e => { if (e.key === "Enter") void save(); }} />
      <input className={"in mono" + (bad ? " bad" : "")} inputMode="decimal" aria-label={`Less percent ${p.name}`} value={less} onChange={e => { setOk(false); setLess(e.target.value); }} onKeyDown={e => { if (e.key === "Enter") void save(); }} />
      {dirty ? <button className="btn sm p" disabled={bad} onClick={save}>Save</button> : <span className={"xs " + (ok ? "ok-text" : "mut")}>{ok ? "✓ saved" : ""}</span>}
    </div>
  );
}

/* Bills and receipts. */
export function PrintingCard() {
  const [width, setWidth] = useState("80mm");
  const [cut, setCut] = useState<ReceiptCut>("partial");
  const [copies, setCopies] = useState("1");
  const [ok, setOk] = useState("");
  const [lines, setLines] = useState<"item" | "full">("item");
  useEffect(() => {
    getShop().then(s => setLines(s.bill_lines === "full" ? "full" : "item")).catch(() => {});
    getSetting("invoice_copies", 1).then(n => setCopies(String(n || 1)));
    getSetting("thermal_width", "80mm").then(setWidth);
    getSetting("receipt_cut", "partial").then(value => setCut(receiptCut(value)));
  }, []);
  const done = (what: string) => { setOk(what); toast(what); };
  return (
    <div className="card"><header><h3>Bill printing</h3>{ok && <><span className="grow" /><span className="pill ok">✓ {ok}</span></>}</header>
      <div className="pad stack">
        <Help label="Item lines on bills" help={lines === "item" ? "One short line per item: name, unit, quantity, rate. Long bills (100–150 lines) stay short. Every counter, every bill format." : "The item's style and colour are printed under its name. Every counter, every bill format."}>
          <select className="in" value={lines} onChange={async e => {
            const v = e.target.value as "item" | "full"; setLines(v);
            try { const s = await getShop(); await saveShop({ ...s, bill_lines: v }); done(v === "item" ? "Bills show item names only" : "Bills show style and colour"); }
            catch (x: any) { toast(x.message, true); }
          }}>
            <option value="item">Item name only (short bills)</option>
            <option value="full">Item + style + colour</option>
          </select></Help>
        <Help label="Tax invoice copies (A4 / A5)" help="How many copies print for one GST invoice. Each is headed Original / Duplicate / Triplicate.">
          <select className="in" value={copies} onChange={async e => { setCopies(e.target.value); await setSetting("invoice_copies", Number(e.target.value)); done("Copies saved"); }}>
            <option value="1">1 — Original only</option><option value="2">2 — Original + Duplicate (transporter)</option><option value="3">3 — Original, Duplicate, Triplicate (GST rule 48)</option></select></Help>
        <Help label="Small receipt printer paper" help="The width of the roll in the small bill printer, if the counter has one.">
          <select className="in" value={width} onChange={async e => { const value = e.target.value; setWidth(value); await db.transaction("rw", db.settings, async () => { await setSetting("thermal_width", value); await setSetting("print_fmt", value); }); done("Paper width saved"); }}>
            <option value="58mm">58 mm</option><option value="80mm">80 mm</option></select></Help>
        <Help label="Receipt cutter" help={receiptCutSetup(cut)}>
          <select className="in" value={cut} onChange={async e => {
            const value = receiptCut(e.target.value);
            try { await setSetting("receipt_cut", value); setCut(value); done("Cutter saved"); } catch { toast("Could not save cutter preference", true); }
          }}>{Object.entries(RECEIPT_CUTS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Help>
        <div className="xs mut">These are kept on this computer. The receipt length always fits the bill.</div>
      </div></div>
  );
}

export function GstCard() {
  const [status, setStatus] = useState<{ t: string; ok: boolean }>({ t: "Checking…", ok: false });
  useEffect(() => { gstRequest().then(j => setStatus(j.configured ? { t: j.sandbox ? "Test provider connected" : "Connected", ok: true } : { t: "Not connected", ok: false })).catch(() => setStatus({ t: "Can't check right now", ok: false })); }, []);
  return (
    <div className="card"><header><h3>E-invoice &amp; e-way bill</h3><span className="grow" /><span className={"pill " + (status.ok ? "ok" : "warn")}>{status.t}</span></header>
      <div className="pad stack">
        <div className="set-intro">{status.ok
          ? "E-way bills and e-invoices are made from the bill screen and sent to the government portal directly."
          : "Bills give you the e-way bill / e-invoice file (JSON) to upload on the government portal yourself. Sending it directly needs a GST provider account, which Riya connects for you."}</div>
      </div></div>
  );
}

/* A number box that lets you type "1.5", "0." or clear it first (owner, 22 Oct: "the point is not working" — every
   key press was turned into a number at once, so the "." vanished). The number is taken when it is a number. */
export function NumberText({ value, onValue, fallback = 0 }: { value: number; onValue: (v: number) => void; fallback?: number }) {
  const [text, setText] = useState(String(value ?? ""));
  useEffect(() => { if (Number(text) !== value && !(text.trim() === "" && value === fallback)) setText(String(value ?? "")); }, [value]);
  return <input className="in mono" inputMode="decimal" value={text} onChange={e => {
    const t = e.target.value.replace(/[^0-9.\-]/g, "");
    setText(t);
    const n = Number(t);
    onValue(t.trim() === "" || t === "-" || t === "." || !Number.isFinite(n) ? fallback : n);
  }} />;
}
