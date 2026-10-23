import type { Store } from "../lib/db";

/* After the PIN, a person allowed into more than one company chooses which one to work in (owner, 23 Oct). */
export function CompanyPicker({ companies, onPick }: { companies: Store[]; onPick: (id: string) => void }) {
  return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 16 }}>
    <div className="card pad stack" style={{ maxWidth: 520, width: "100%" }}>
      <h2 style={{ margin: 0 }}>Which company?</h2>
      <div className="xs mut">Each company keeps its own stock, purchases, bills and reports. You can change it later from the menu.</div>
      <div className="home-main-jobs">{companies.map(c => <button key={c.id} type="button" className="home-job" style={{ border: 0, textAlign: "left", cursor: "pointer" }} onClick={() => onPick(c.id)}>
        <span><b>{c.name}</b><small>{c.kind === "estimate" ? "Estimates" : c.kind === "gst" ? "Tax invoices & challans" : "Invoices, challans & estimates"}</small></span></button>)}</div>
    </div>
  </div>;
}
