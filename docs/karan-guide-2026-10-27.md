# What changed: 27 Oct (for Karan)

## 0. Once, before anything else (Riya)
1. Supabase › SQL Editor: run `supabase/migrations/20261027120000_company_separation.sql`.
2. Supabase › Authentication › Sign In / Providers: **Anonymous sign-ins ON** (counters connect as "this shop device").
3. On every laptop and phone: press **Ctrl + Shift + R** once to load the new version.

## 1. Signing in
- A person or PIN made on one computer now opens on the others within seconds. If a computer doesn't know a name yet, it asks the cloud before saying "not recognised".
- After 5 wrong tries the wait is **15 seconds, then 30 seconds** (it used to be up to 5 minutes).

## 2. Search
- Search shows only what that person may open. Without the tick **Search bar (Ctrl K)** there is no search at all.
- The built-in roles still have search. For custom roles and people with their own ticks: **Roles › tick "Search bar"** wherever it should be allowed.

## 3. Photo while stocking in
**Stock in › scan a packet › Photo.** The picture goes with the packet scanned last, stays with that stock entry, and becomes the product's picture if it has none. "Camera scan" is the barcode camera, as before.

## 4. Companies (master owner)
1. Sign in with **Rungnna 2026** and your PIN › **Companies & transfers**.
2. **Set the master code.** It is only for you; write it down. From now on, *master code + your PIN* is the only way to see every company.
3. **Make a company:** name (e.g. AJ), short code (AJ), entry code (e.g. AJ 2026). It starts with the same layout and bill details as Rungnna, with the GSTIN left blank.
4. Open the company's card:
   - **Who can open it:** tick its staff.
   - **Features:** untick what it should not have, e.g. *Search bar*.
   - **Auto-logout:** minutes without use before it signs out (0 = never).
5. Give the staff **only that company's entry code**. They type it, then their own name and PIN. They see only that company: no list, no switcher, nothing about other companies.
6. Inside the new company (its entry code, or the switcher in the master view): **Settings › Shop** › its GSTIN, address and bank.
7. **Moving goods between companies:** master view › Companies & transfers › Transfer out. If the two companies have different GSTINs, ask your CA how to bill it.

## 5. What each company keeps
- **Its own:** stock and racks, bills and bill numbers (with its code, e.g. `INV/26-27/AJ…`), purchases, payments, returns, vouchers, khata dues, and bill details/GSTIN.
- **Shared:** the design list (products and stickers), and customer and supplier names.

## 6. Counters
- A counter for one company must be connected as **this shop device**, not with your email. Your email login sees every company. (Settings › Cloud backup shows which one; *Disconnect*, then type the company's entry code.)
- The first time a counter uses a new company's code it needs internet. After that it works offline as usual.
- A counter used by two companies keeps what it already has from both. For full separation, give each company its own laptop or browser.

## Not done
Estimate bills showing a fraction of the real amount, or a company whose sales or stock are kept out of the records. Every amount is saved as it really is.
