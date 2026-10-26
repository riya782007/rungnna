import { useState } from "react";
import type { Store } from "../lib/db";
import { useApp, toast } from "../lib/app";
import { setUpTwoCompanies } from "../lib/stores";

/* Owner, 26 Oct: "one round button at the top — tap it and the whole app (home, bills, stock in/out, sale today)
   is the kachha (estimate) company; tap again and it is the pakka (GST) company." Nothing new to learn: the two
   companies already keep their own bills, stock and home figures; this is one tap between them.
   The first tap by the owner, before the estimate company exists, makes it (after asking). */
export function CompanyToggle({ companies }: { companies: Store[] }) {
  const { me, store, switchStore } = useApp();
  const [busy, setBusy] = useState(false);
  const here = companies.find(c => c.id === store);
  const est = companies.find(c => c.kind === "estimate");
  const gst = companies.find(c => c.kind === "gst") || (est && companies.find(c => c.kind !== "estimate"));
  const owner = me?.role === "owner";
  if (!(gst && est) && !owner) return null;   // staff who may open only one company: nothing to switch
  const kachha = here?.kind === "estimate";
  const target = kachha ? gst : est;
  const flip = async () => {
    if (busy) return;
    setBusy(true);
    try {
      let to = target?.id;
      if (!to) {
        if (!confirm("Make a separate Kachha (estimate) company?\n\nThis company becomes Pakka (GST bills). Kachha gets its own estimate bills, stock in / out and home page. Bills and stock you already have stay here.")) return;
        to = (await setUpTwoCompanies()).id;
      }
      await switchStore(to);
      toast(kachha ? "Pakka · GST bills" : "Kachha · Estimates");
    } catch (e: any) { toast(e.message || "Could not switch company", true); }
    finally { setBusy(false); }
  };
  const now = kachha ? "Kachha · Estimates" : "Pakka · GST bills";
  const next = kachha ? "Pakka (GST)" : "Kachha (Estimates)";
  return <button type="button" className={"company-toggle " + (kachha ? "kachha" : "pakka")} onClick={() => void flip()} disabled={busy}
    title={`Now: ${now}. Tap for ${next}`} aria-label={`Company: ${now}. Tap to switch to ${next}`}>
    <span className="ct-circle">{kachha ? "K" : "P"}</span>
    <span className="ct-text"><b>{kachha ? "Kachha" : "Pakka"}</b><small>{kachha ? "Estimates" : "GST bills"}</small></span>
  </button>;
}
