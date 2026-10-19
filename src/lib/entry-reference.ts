/** Shop-local date, independent of the counter computer's timezone. Not an invoice identifier. */
export function entryReference(name: string, at = new Date()): string {
  const initial = name.trim().match(/[A-Za-z]/)?.[0]?.toUpperCase();
  if (!initial || !Number.isFinite(at.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "2-digit" }).formatToParts(at);
  const value = (type: string) => parts.find(p => p.type === type)?.value || "";
  return initial + value("day") + value("month") + value("year");
}
export function checkedEntryReference(value: string | undefined): string {
  const code = (value || "").trim().toUpperCase();
  if (code.length > 24 || !/^[A-Z0-9./-]*$/.test(code)) throw new Error("Reference code: use up to 24 letters, numbers, /, . or -");
  return code;
}
