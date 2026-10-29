import { forwardRef, useEffect, useState } from "react";
import { db, type Product } from "../lib/db";
import { parseQuickLine, type QuickLine } from "../lib/quick-line";

/* Owner, 29 Oct: typing a bill by hand must be as fast as reading it. One box above the lines: type a bill line
   the way it is printed, see what it understood underneath, Enter adds it and the box is ready for the next line.
   A code bought before fills in what was not typed (item, cost, packet) from the saved article. */

export type QuickAdd = QuickLine & { known?: Product };
const up = (v?: string) => (v || "").trim().toUpperCase();
const rupees = (paise?: number) => (paise ? (paise / 100).toFixed(2).replace(/\.00$/, "") : "");

export const QuickLineBox = forwardRef<HTMLInputElement, { prevItem: string; prevPack?: number; expectCode: boolean; money: boolean; nextSr: string; onAdd: (l: QuickAdd) => void; disabled?: boolean }>(
  function QuickLineBox({ prevItem, prevPack = 1, expectCode, money, nextSr, onAdd, disabled }, ref) {
    const [text, setText] = useState("");
    const [known, setKnown] = useState<Product | undefined>();
    const [last, setLast] = useState("");
    const parsed = text.trim() ? parseQuickLine(text, prevItem, expectCode) : undefined;
    /* boxes of the same size as the line above, when the pieces divide evenly ("24 65" under a "4x12" line = 2 boxes
       of 12). Typing 1x24 or 24x1 says otherwise. */
    const asAbove = !!parsed?.ok && !parsed.line.pack && prevPack > 1 && Number(parsed.line.qty) % prevPack === 0;
    const r = parsed?.ok && asAbove ? { ...parsed, line: { ...parsed.line, pack: String(prevPack), stickers: String(Number(parsed.line.qty) / prevPack) } } : parsed;
    const style = r?.ok ? up(r.line.style) : "";
    useEffect(() => {
      let live = true;
      if (!style) { setKnown(undefined); return; }
      void db.products.where("style").equals(style).toArray().then(list => { if (live) setKnown(list.find(p => !p.deleted)); });
      return () => { live = false; };
    }, [style]);

    const add = () => {
      if (!r?.ok) return;
      const l = { ...r.line };
      if (known) {
        if (r.carried || !l.item) l.item = known.item?.trim() ? up(known.item) : l.item;
        if (!l.cost && known.cost) l.cost = rupees(known.cost);
        if (!l.pack && (known.pack || 1) > 1) l.pack = String(known.pack);
      }
      onAdd({ ...l, known });
      setLast(text); setText("");
    };

    const show = r?.ok ? r.line : undefined;
    return <div className="quick-line stack" style={{ gap: 4 }}>
      <div className="row" style={{ gap: 8 }}>
        <span className="quick-sr mono b" title="The bill's Sr. this line gets">Sr. {nextSr}</span>
        <input ref={ref} className="in grow quick-in" value={text} disabled={disabled} spellCheck={false} autoComplete="off"
          aria-label="Type a bill line"
          placeholder={money ? "Type the bill line: TIKA 19430 12 51   ·   4x12 = 4 boxes of 12   ·   Enter adds it" : "Type the bill line: TIKA 19430 12   ·   4x12 = 4 boxes of 12   ·   Enter adds it"}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) { e.preventDefault(); e.stopPropagation(); add(); }
            else if (e.key === "ArrowUp" && !text && last) { e.preventDefault(); setText(last); }   // bring back the last line to change it
            else if (e.key === "Escape") setText("");
          }} />
        <button type="button" className="btn p" disabled={disabled || !r?.ok} onClick={add}>Add line</button>
      </div>
      {r && <div className={"sm quick-preview " + (r.ok ? "" : "bad-text")} role="status">
        {r.ok && show ? <>→ <b>{known && r.carried && known.item ? up(known.item) : show.item}</b>
          {show.style ? <> · code <b className="mono">{show.style}</b></> : <> · <i>no code — made from item + cost</i></>}
          {" · "}<b>{show.qty}</b> pcs{show.stickers ? <> in <b>{show.stickers}</b> box{show.stickers === "1" ? "" : "es"} of <b>{show.pack}</b>{asAbove ? " (like the line above)" : ""}</> : null}
          {money && (show.cost || known?.cost) ? <> · cost <b>₹{show.cost || rupees(known?.cost)}</b>{!show.cost ? " (last time)" : ""}</> : null}
          {known ? <span className="ok-text"> · known article</span> : null}</> : !r.ok ? r.error : null}
      </div>}
    </div>;
  });
