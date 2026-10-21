# Rungnna Shop OS: app conversion feasibility

Research and planning only. Nothing here changes the live system. A Windows desktop prototype exists on branch `feat/windows-desktop-app`. It is **not merged, not built, not tested**, and it is listed under Plan, step 3.

---

## 1. Executive summary for the owner

**Will every feature work inside the app?**
Yes. The app would be the same program the shop uses today, packed as an app, not a rewrite. Billing, estimates, stock, labels, customers, reports and the rest stay the same. A few things need the internet in the app too, just like today: AI bill reading, Ask, GST e-invoice, photo upload and cloud sync.

**Can I run the shop from my phone?**
- **Android:** yes. The phone can already "install" the website as an app. A proper Android app (APK) is also possible.
- **iPhone:** possible, but slower to deliver. Apple requires a paid developer account, a review, and has Bluetooth limits (see below).

**Can I print stickers and bills from my phone over Bluetooth?**
Yes, if you buy the right printer. The app already creates the exact printer commands for your TSC sticker labels. Only the "cable" changes, from USB to Bluetooth.
- Buy a printer that supports **Bluetooth Low Energy (BLE)** and the **TSPL** label language. Most cheap printers are "classic Bluetooth" only, which iPhones and web apps can't use.
- **Test before you buy in bulk.**

**Will the shop stop while you build this?**
No. The website stays exactly as it is. The app is built and tested separately, and it reads and writes the same shop data. If a phone or printer misbehaves, staff simply open the website as they do today.

**One honest note:** a held (unfinished) bill lives on the device that made it, until it is saved. Finish or save bills on the same device before switching to another.

---

## 2. Technical feasibility report

### 2.1 Codebase audit (repo `riya782007/rungnna`)

**Stack.** React 18, TypeScript and Vite. Data lives offline-first in IndexedDB (Dexie) with an outbox sync to Supabase. Serverless endpoints run on Vercel (`api/`). The app is a PWA (`vite-plugin-pwa`). There are 75 test files (vitest).

**Feature inventory (26 screens in `src/pages`):**

| Area | Workflows |
|---|---|
| Counter | **Billing**: GST invoice, private estimate (code-locked), challan, hold/resume, boxes, F2–F12 keys, camera, scanner gun, phone-as-scanner, RFID, voice order, payments, WhatsApp share. **Bills**: view, void, return, merge, split, convert. **Recheck** |
| Stock | Products, Stock in, Scan & record, Add inventory, Racks, Move, RFID count, Activity, Stores & transfers, Import |
| Labels | **QR labels**: old-software QR format (`ICODE~RATE~PACK~REF~TK~STYLE~COLOR`), own QR, TSPL commands for TSC, bitmap labels, rack and bag labels. AI purchase-bill photo reading |
| Parties & money | Customers / khata, Suppliers, Dealers & trade orders, Vouchers, Bank reconciliation, Reports (GSTR-1, P&L, salesman, helper) |
| Control | Settings, Roles & permissions, private estimate lock, Ask (AI), online catalogue |

**Not in the code:** gold or silver weight, metal rates, making charges. The shop sells **imitation jewellery** priced per piece or packet. If weight-based billing is wanted, it's a new feature, not part of the conversion.

**Web-specific dependencies and how each behaves in an app container:**

| Dependency | Used for | Electron (Windows) | Capacitor / Android WebView | iOS WKWebView |
|---|---|---|---|---|
| IndexedDB (Dexie) | all offline data | ✅ | ✅ (persists; can be cleared by "Clear data") | ✅ |
| Service worker (PWA) | offline web cache | not needed (files bundled) | not needed (bundled) | not needed |
| `window.print()` + print CSS (`lib/printing.ts`) | invoices, browser labels | ✅ system print dialog | ⚠ Android WebView has no `window.print`; needs a print plugin | ⚠ needs a plugin |
| Web Serial / WebUSB (`lib/tsc.ts`) | TSC printer direct | ✅ with device-picker handlers (in prototype) | ❌, replace with native USB/Bluetooth plugin | ❌ |
| Web Bluetooth | (not used yet) | ✅ BLE | ⚠ not in WebView; use native BLE plugin | ❌ |
| Camera `getUserMedia` + zxing WASM (`Scanner.tsx`) | QR/barcode scanning | ✅ | ✅ with camera permission in manifest | ✅ (iOS 14.3+) |
| `MediaRecorder` (`Voice.tsx`) | voice orders | ✅ | ✅ (mic permission) | ⚠ codec differences, test |
| `navigator.vibrate`, Web Audio beeps | scan feedback | ✅ / ✅ | ✅ / ✅ | ❌ vibrate / ✅ |
| `window.open` (WhatsApp `wa.me`) | sharing | route to external browser | route via App/Browser plugin | same |
| `location.origin` (dealer, catalogue, phone-scanner links) | shared links | must be the public site (prototype fixes this) | same | same |
| `fetch("/api/…")` relative | AI, GST, media | proxy or absolute URL to Vercel | absolute URL + CORS on Vercel | same |
| `localStorage` / `sessionStorage` (4 files) | small UI state | ✅ | ✅ | ✅ |

### 2.2 Supabase integration and security

- **Auth:** one shop account, using email and password (`sync.ts`, `signInWithPassword`). Sessions are stored by supabase-js in local storage, which works the same in every container.
- **Staff access:** handled on the device (PIN, role passcodes, `lib/roles.ts`), not by the database.
- **RLS:** enabled. Policies are `for all to authenticated using (true)`, which means **anyone holding the shop login can read or write every table**.
  - This is acceptable for one shop on its own counters today.
  - It becomes a **real risk once the app is on staff phones**: a phone holding the login holds full database access.
  - Before handing phones to staff, consider per-staff Supabase users, plus role-based RLS for sensitive tables (bills void, estimates, roles).
- **Sync:** an outbox that upserts by `id`, then incremental pulls by `updated_at`.
  - Conflicts: **last write wins** for master data. Stock movements are append-only.
  - Bill numbers come from a **per-counter series** (`counterCode`), so offline devices never clash on numbers.
  - So the web app and new apps can share the database safely, **as long as each device has its own counter code.**
- **Realtime:** used only for phone-as-scanner (`remote.ts`, broadcast and presence channels). Works unchanged in any container with internet.
- **Server endpoints** (Vercel): AI, purchase photo, GST, media, WhatsApp, public pages. Apps call them with an absolute URL. They need CORS for non-website origins (Capacitor uses `https://localhost` / `capacitor://localhost`).

### 2.3 Packaging options

| | PWA (today) | Capacitor | Tauri v2 | Electron |
|---|---|---|---|---|
| Reuse of current code | 100% | ~95% (print + printer transport swapped) | ~90% (WebView2 / WebKit; device APIs via Rust plugins) | ~99% |
| Offline start | via service worker cache (can be cleared or stale) | files bundled ✅ | bundled ✅ | bundled ✅ |
| Bluetooth printer | Android Chrome: BLE only, through a chooser each session; iOS ❌ | native plugins: BLE, and classic Bluetooth on Android ✅ | plugins exist but younger; more custom Rust work | BLE ✅; classic Bluetooth through a paired COM port ✅ |
| USB TSC on counter PC | ✅ in Chrome (WebUSB/Serial) | n/a | ⚠ WebView2 serial/USB support needs verification | ✅ |
| Size / memory | none / browser | ~10–20 MB APK | ~10 MB install, low RAM | ~90 MB install, ~150–250 MB RAM |
| Platforms | all | Android, iOS | Windows, macOS, Linux, Android, iOS | Windows, macOS, Linux |
| Store release | none | Play (days), App Store (review + Mac/CI) | same as Capacitor | none (direct download) |

### Recommendation matrix (5 = best)

| Option | Speed at counter | Cost / time to Tuesday | Bluetooth printing | Zero-downtime | **Total** |
|---|---|---|---|---|---|
| **Electron for counter PCs** | 5 | 5 (prototype exists) | 4 | 5 | **19** |
| **Capacitor for Android** | 4 | 3 | 5 | 5 | **17** |
| PWA install (Android, now) | 3 | 5 | 2 | 5 | 15 |
| Tauri v2 (all) | 5 | 2 | 3 | 5 | 15 |
| Capacitor for iOS | 4 | 1 | 3 (BLE only) | 5 | 13 |

**Recommendation:** use **Electron on the counter PC**, where speed matters most, and **Capacitor for Android phones**, where Bluetooth printing matters most.
- Keep the PWA as the zero-install fallback.
- Defer iOS until the Android flow is proven.
- Revisit Tauri later if install size or memory become a concern.

---

## 3. Bluetooth thermal printing

### 3.1 Protocols

- **Classic Bluetooth (SPP / "serial")**
  - What most cheap printers use.
  - Android native apps: ✅. Web Bluetooth: ❌ never. iOS: ❌ unless the printer is Apple-certified (MFi).
- **Bluetooth Low Energy (BLE, GATT write characteristic)**
  - Web Bluetooth (Android Chrome): ✅. Capacitor BLE plugin on Android and iOS: ✅.
  - **This is the requirement for iPhone support.**
- **Native route (recommended):** a Capacitor BLE plugin for BLE printers, plus an Android classic-serial plugin as a fallback. The app's existing TSPL byte builder feeds both.

### 3.2 Rendering strategy

| Approach | Pros | Cons | Use for |
|---|---|---|---|
| **Command bytes (TSPL for stickers, ESC/POS for receipts)** | fast, sharp, tiny data, works over slow BLE | printer-language specific | **stickers** (already built: `label-tspl.ts`) and receipts |
| Raster bitmap (canvas → TSPL `BITMAP` / ESC/POS `GS v 0`) | prints exactly what you see, any font | large data, slow over BLE (chunk writes of 100–500 bytes) | bilingual or complex invoices; the app already has `label-bitmap.ts` |
| HTML + `window.print` | zero work on desktop | not available in mobile webviews; driver-dependent | A4/A5 invoices on the counter PC |

**Plan:**
- **Stickers:** reuse the existing TSPL commands.
- **58/80 mm receipts:** add an ESC/POS builder (text plus QR command), with bitmap fallback for Hindi.
- **A4/A5 invoices:** stay on the PC (print dialog) or use PDF share on the phone (`lib/pdf.ts` exists).

### 3.3 Hardware checklist (verify with the vendor before buying)

1. **BLE support**, not only classic Bluetooth. Needed for iPhone and preferred everywhere.
2. **TSPL (TSC-compatible) command set** for labels, so the current sticker commands work unchanged. ESC/POS for receipts. "Dual mode label + receipt" models exist.
3. **Print width:** 2-inch (≈48–54 mm) for stickers; 58 mm or 80 mm for receipts. 203 dpi is enough for the current QR size; 300 dpi gives sharper small text.
4. **Gap/black-mark sensor** for die-cut sticker rolls, matching the current label size and gap (Labels → Printer settings).
5. **Test one unit first:** print 50 stickers from the old-software QR format and scan them back in Billing before buying more.

---

## 4. Zero-downtime migration

1. **Shared data**
   - Every client (web, desktop, Android) writes to its own device first, then upserts by id to the same Supabase tables.
   - Bill numbers are per-counter, so there are no clashes.
   - Rules for safety:
     - each device gets its own counter code (check under Settings);
     - add new database columns only as **additive, nullable** migrations, run *before* apps that use them. The sync already skips unknown columns safely.
2. **Staging**
   - A second Supabase project with the same migrations, used by test builds through a separate `.env.staging`.
   - Test devices can also run in the app's existing **offline mode** (cloud sync off) to try printing and billing without touching shop data.
   - Use Vercel preview deployments for API changes. Production deploys only from `main`.
3. **Parallel run:** for one week, the counter PC runs the desktop app while the website stays open on another device. Compare the day's totals (Reports) every evening.
4. **Fallback**
   - The website is never switched off.
   - If a phone or printer fails: finish or save the current bill, then continue on the website or desktop app. Data arrives after the next sync.
   - Print from the PC instead (USB TSC, already working).

---

## 5. Plan: three working days (Sunday → Tuesday)

1. **Day 1 (Sunday): decide and set up**
   - Owner confirms the printer model; check it against §3.3.
   - Create the staging Supabase project and run all migrations.
   - Add CORS on the Vercel `api/` for app origins.
   - Agree on counter codes per device.
2. **Day 2 (Monday): build**
   - **Desktop:** merge and build the Electron prototype (`feat/windows-desktop-app`; GitHub Actions makes the `.exe` and `.zip`). Test it offline on the counter PC: bill, hold, estimate lock, labels to the TSC printer, sync after reconnect.
   - **Android:** add Capacitor around the same build; route `/api` to the absolute Vercel URL; add a BLE printer transport feeding the existing TSPL bytes; add camera and mic permissions; build a debug APK.
3. **Day 3 (Tuesday): test and hand over**
   - Run the staging tests: 50-sticker print-and-scan round trip, 20-bill offline session, then reconnect and confirm sync. Two devices billing at the same time; numbers must not clash.
   - Then: install on the shop devices, train on the fallback, and start the one-week parallel run.
   - **Not by Tuesday:** iOS App Store release, Play Store listing, and per-staff database security. Each needs its own schedule.

## 6. Risks and mitigation

| Risk | Impact | Mitigation |
|---|---|---|
| Bluetooth pairing drops mid-print | half a sticker batch | print in small batches, resume from the last label number (labels are already numbered), auto-reconnect, USB fallback on the PC |
| Printer is classic Bluetooth only | no iPhone; no web printing | buy BLE + TSPL (§3.3); on Android use the native serial plugin |
| Internet down | sync and AI stop | billing, stock and labels are offline-first; the outbox sends later; the app says which features need internet |
| Held bill on one device, user switches device | bill "missing" | save before switching; held bills are per device until saved (shown in Held) |
| Two devices edit the same product at the same time | last edit wins | edit products on one device; bills and movements are not affected |
| WebView permission denied (camera, mic, Bluetooth) | scanning or printing fails | request permissions on first run, with a clear message and a link to settings |
| Android clears app data / phone lost | unsynced bills lost; full DB access on a lost phone | sync often (status shown); remote sign-out; per-staff accounts and RLS before rollout to staff phones |
| New app version needs a DB column the cloud lacks | sync errors | additive migrations first; sync skips missing columns |
| Unsigned Windows installer warning | staff confusion | instructions ("More info → Run anyway"); code-signing certificate later |
| Electron memory on old PCs | sluggish | prototype disables background throttling; if RAM is under 4 GB, evaluate Tauri |
