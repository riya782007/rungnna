/* Owner, 13 Nov (voice): "the customers' numbers we note in the software — how will they come into our phone's
   contacts?" One file with every customer as a phone contact (vCard). Opened on the phone it adds them to the
   contacts — WhatsApp then shows their names — and Google Contacts on a computer imports the same file. */
import type { Party } from "./db";

const esc = (s: string) => (s || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1").trim();
/** +91 98xxxxxxxx for a 10-digit Indian mobile; other numbers as typed. "" when there is none. */
export function contactPhone(phone: string): string {
  const d = (phone || "").replace(/\D/g, "");
  if (d.length === 10) return "+91" + d;
  if (d.length === 12 && d.startsWith("91")) return "+" + d;
  return d.length >= 8 ? d : "";
}
export function vcard(p: Party, group = "Rungnna customers"): string {
  const tel = contactPhone(p.phone); if (!tel) return "";
  const name = [p.name, p.alt_name && p.alt_name !== p.name ? p.alt_name : "", p.city].filter(Boolean).join(" ").trim() || tel;
  const lines = ["BEGIN:VCARD", "VERSION:3.0", `FN:${esc(name)}`, `N:;${esc(name)};;;`, `TEL;TYPE=CELL:${tel}`];
  if (p.alt_name) lines.push(`ORG:${esc(p.alt_name)}`);
  if (p.address || p.city || p.pin) lines.push(`ADR;TYPE=WORK:;;${esc(p.address)};${esc(p.city)};${esc(p.state)};${esc(p.pin || "")};India`);
  if (p.gstin) lines.push(`NOTE:GSTIN ${esc(p.gstin)}`);
  lines.push(`CATEGORIES:${esc(group)}`, "END:VCARD");
  return lines.join("\r\n");
}
/** Every customer with a mobile number, once per number. */
export function vcards(parties: Party[]): { text: string; count: number } {
  const seen = new Set<string>(), out: string[] = [];
  for (const p of parties) {
    if (p.deleted || p.kind === "supplier") continue;
    const tel = contactPhone(p.phone); if (!tel || seen.has(tel)) continue;
    seen.add(tel); out.push(vcard(p));
  }
  return { text: out.join("\r\n") + (out.length ? "\r\n" : ""), count: out.length };
}
/** Phone: the share sheet (pick Contacts); computer: the file is downloaded for Google Contacts → Import. */
export async function saveContacts(text: string, name: string): Promise<"shared" | "downloaded" | "cancelled"> {
  const file = new File([text], name, { type: "text/vcard" });
  const nav = navigator as any;
  try { if (nav.canShare?.({ files: [file] })) { await nav.share({ files: [file] }); return "shared"; } }
  catch (e: any) { if (e?.name === "AbortError") return "cancelled"; }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return "downloaded";
}
