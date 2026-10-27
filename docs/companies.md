# Companies (owner, 27 Oct)

Karan: one master owner creates as many companies as he wants. Each company has its own entry code, staff only ever see the company they came in through, and the owner decides which features each company has.

This brings back separate companies after #67 ("one company again"). It does **not** bring back the Kachha/Pakka switch (#64, reverted): there is no button, list or switcher anywhere that shows another company exists.

## Decisions (how Invock / Tally / Busy do it for traders like us)

| Question | Decision | Why |
|---|---|---|
| Own GSTIN, bill details, numbering? | **Yes, per company.** Each company has its own shop profile (name, GSTIN, address, bank, terms), copied from the main company when it is made so the layout is the same. Bill numbers carry the company code (`INV/26-27/AJC7K0001`), so no two companies share a number. | Tally and Busy keep one company per legal entity, each with its own GSTIN, books and returns. Invock does the same per business. |
| Can one person work in several companies? | **Yes, if the owner ticks it** (Staff › person › Companies). But each sign-in opens **one** company, the one whose entry code was typed, and there is no switcher. | Multi-company apps assign users per company. Karan wants staff in one company never to see that another exists. |
| Shared or separate stock? | **Separate stock, shared design list.** Products (designs, codes, stickers) are one list, so a design never has to be made twice. Stock, racks, bills, purchases, payments, vouchers and khata balances belong to the company they were made in. Moving goods between companies is a **stock transfer**, done by the owner from the master login. | This is how Tally (group companies with a shared item master) and Invock (multi-store) keep stock. Between two GSTINs a transfer is a sale for GST purposes, so the CA should confirm how it is billed. |
| Separate books per company? | **Yes.** Every company already keeps its own bills, receipts, purchases, returns, vouchers and ledgers (`store_id` on every record, filtered everywhere by `inStore`). Customers and suppliers are one shared list; each company shows only its own dues. | Same as above. |

## How it works

- **Master code (owner only).** Settings › Companies sets a separate master code. The master code plus the owner's PIN opens the master view: every company, the company switcher, creating companies, entry codes, features, staff access, auto-logout and transfers.
  - Until a master code is set, the owner signing in with the main entry code is the master, as before.
- **Company entry code.** Each company has its own entry code, e.g. "Rungnna 2026" for the main company and "AJ 2026" for another. It is stored only as a salted hash and synced to every counter. After the code, the person signs in with their own name and PIN as usual.
- **Who may open a company.** The owner can open every company. Anyone else may open only a company ticked for them. Otherwise the sign-in says "Name or PIN not recognised", the same as a wrong PIN, so it never hints that the company exists.
- **Features per company.** The owner ticks which features a company has. Inside it, every person gets only what both their own role and the company allow: the menu, tabs, search and every guarded save follow it. Turning off *Search bar* removes search in that company.
- **Auto-logout per company.** Set in minutes. With no tap or key for that long, or after the app has been away for more than a minute, the person goes back to the sign-in screen. Unsaved bills stay in Held.

## Not built

- Estimate amounts shown at a fraction of the real amount, and a company whose sales or stock are kept from the books or from inspection. Every amount is recorded as it really is.
- Server-side separation per company. As today, every counter syncs the whole shop and the app enforces companies on the device (see README, *Things to know*). Real server separation needs a cloud login for each company.
