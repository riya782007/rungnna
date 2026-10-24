import { useState } from "react";
import { saveShop, type Shop } from "../lib/billing";
import { toast, useApp } from "../lib/app";
import { can } from "../lib/roles";

/* Owner, 24 Oct: "tax invoice with complete address and all the required details". The shop profile in the
   cloud has no address, GSTIN, phone or state yet, so tax invoices printed without them. Asked once, right on
   the bill screen, with the shop's public address filled in; the owner only checks it and types the GSTIN. */
const LISTED_ADDRESS = "5827, Gali Matke Wali, Sadar Bazar, Delhi - 110006";
const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const shopNeedsTaxDetails = (s: Shop) => !s.gstin?.trim() || !s.address?.trim() || !s.state?.trim();

export function ShopDetailsAsk({ shop, onSaved }: { shop: Shop; onSaved: (s: Shop) => void }) {
  const { me } = useApp();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ address: shop.address || LISTED_ADDRESS, state: shop.state || "DELHI", gstin: shop.gstin || "", phone: shop.phone || "" });
  if (!can(me, "settings.manage")) return <div className="note warn sm">Tax invoices need the shop's address and GSTIN. Ask the owner to fill them once (Settings → Shop profile).</div>;
  if (!open) return <div className="note warn sm row" style={{ gap: 8, flexWrap: "wrap" }}><span className="grow">Tax invoices print without the shop's {[!shop.address?.trim() && "address", !shop.gstin?.trim() && "GSTIN", !shop.state?.trim() && "state"].filter(Boolean).join(", ")}.</span>
    <button className="btn sm p" onClick={() => setOpen(true)}>Fill once</button></div>;
  const gstin = v.gstin.trim().toUpperCase();
  const save = async () => {
    if (gstin && !GSTIN_RE.test(gstin)) return toast("GSTIN should be 15 letters/digits, e.g. 07ABCDE1234F1Z5", true);
    const next = { ...shop, address: v.address.trim(), state: v.state.trim().toUpperCase(), gstin, phone: v.phone.trim() };
    try { await saveShop(next); onSaved(next); setOpen(false); toast("Shop details saved — every tax invoice now carries them"); }
    catch (e: any) { toast(e.message, true); }
  };
  return <div className="note stack" role="group" aria-label="Shop details for tax invoices">
    <b>Shop details for tax invoices</b>
    <label className="f">Address<input className="in" value={v.address} onChange={e => setV({ ...v, address: e.target.value })} /></label>
    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
      <label className="f">GSTIN<input className="in mono" value={v.gstin} maxLength={15} placeholder="07XXXXX0000X1Z5" onChange={e => setV({ ...v, gstin: e.target.value.toUpperCase().replace(/\s/g, "") })} /></label>
      <label className="f">State<input className="in" value={v.state} onChange={e => setV({ ...v, state: e.target.value })} /></label>
      <label className="f">Phone<input className="in" inputMode="tel" value={v.phone} onChange={e => setV({ ...v, phone: e.target.value })} /></label>
    </div>
    <div className="row" style={{ gap: 8 }}><button className="btn p" onClick={() => void save()}>Save</button><button className="btn" onClick={() => setOpen(false)}>Later</button></div>
  </div>;
}
