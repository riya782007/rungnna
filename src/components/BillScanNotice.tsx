import { useEffect } from "react";
import { CheckCircle2 } from "lucide-react";
import type { BillLine } from "../lib/db";

export type BillScanFeedback = {
  sequence: number;
  line: Pick<BillLine, "item" | "style" | "color" | "qty" | "type" | "box_no">;
  added: number;
  repeated: boolean;
};

/** A receipt of the committed addition; never takes keyboard focus from scanning. */
export function BillScanNotice({ feedback, onClose }: { feedback: BillScanFeedback; onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 2800);
    return () => clearTimeout(timer);
  }, [feedback.sequence, onClose]);
  const { line, added, repeated } = feedback;
  return <div className="bill-scan-notice" role="status" aria-live="polite" aria-atomic="true" data-scan-sequence={feedback.sequence}>
    <CheckCircle2 size={28} aria-hidden="true" />
    <div className="grow">
      <b>{repeated ? "Repeated item added" : "Item added"} · +{added} {line.type || "PCS"}</b>
      <strong>{line.item}</strong>
      <span>{[line.style, line.color].filter(Boolean).join(" · ")}</span>
      <span>Box {line.box_no} · Quantity now {line.qty} {line.type || "PCS"}</span>
    </div>
    <button className="x" aria-label="Dismiss item confirmation" onMouseDown={e => e.preventDefault()} onClick={onClose}>×</button>
  </div>;
}
