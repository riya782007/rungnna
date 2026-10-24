/* The open company's kind (owner, 23 Oct): "estimate" bills only estimates, "gst" only invoices and challans.
   Its own module so both scope and roles can read it without importing each other. */
let kind: "gst" | "estimate" | undefined;
export const setCompanyKind = (k?: "gst" | "estimate") => { kind = k; };
export const companyKindNow = () => kind;
/* Owner, 24 Oct: "in private estimates there is no option to make a bill — it has to be enabled". Someone ticked
   for private estimates makes the estimate company's bills (estimates) even without "Make bills", which then
   still decides the tax-invoice company. */
export const estimateBilling = (key: string, has: (k: string) => boolean) => key === "billing.sell" && kind === "estimate" && has("estimates.open");
