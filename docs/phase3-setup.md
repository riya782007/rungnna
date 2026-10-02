# Phase 3 Setup

Run `supabase/migrations/0012_phase3_invock_parity.sql` in the Supabase SQL Editor after migrations 0001–0011. This migration is transactional and can be run again. Existing records remain in Main store. It does not submit invoices or modify government registrations.

## Account Roles

The existing app uses a shared shop login plus local staff PINs. Store assignments in the app control the offline screens. For server-enforced branch isolation, give staff separate Supabase Auth accounts and assign administrator-controlled `app_metadata`. A shared login cannot distinguish two staff members on the server.

Find the account IDs in Authentication → Users. Run these statements for the intended accounts, replacing the UUIDs. Refresh their login afterwards so the new claims take effect:

```sql
-- Owner account: enables store setup, bank sync and migration history sync.
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
  || jsonb_build_object('role', 'owner')
where id = 'REPLACE-WITH-OWNER-AUTH-UUID'::uuid;

-- Salesman account: use the store UUID shown in public.stores.
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
  || jsonb_build_object('role', 'salesman', 'store_id', 'REPLACE-WITH-STORE-UUID')
where id = 'REPLACE-WITH-SALESMAN-AUTH-UUID'::uuid;
```

Keep legacy shared-shop accounts owner-operated. Do not grant them to salesmen who require server-enforced isolation. Legacy accounts without a role retain the original app's legacy table access so upgrading does not strand existing devices. New bank/import/store writes require the owner role.

## E-invoice and E-way Bill

Download JSON works offline. Complete the shop GSTIN/address and each invoice's dispatch/delivery details. Each item can carry its own HSN; older invoices fall back to the shop HSN. New GST and challan numbers are compact, retain their document prefix and must fit the government's 16-character limit. Existing long numbers are flagged instead of silently renamed.

The e-invoice file is an array of GST INV-01 version 1.1 documents. The EWB file contains `version` and `billLists`. GST invoice and challan exports use different document/sub-supply types. Taxable value, discounts, packing and tax are allocated in integer paise to preserve saved totals. Estimates are not government documents.

Live submission needs a GSP/ASP contract. No provider account is assumed. The included `http-gsp` adapter talks to a provider bridge implementing the following contract; implement another adapter in `api/_gst-provider.ts` for a vendor's native API.

Set these **server-only** Vercel variables, never `VITE_` variables:

| Variable | Value |
| --- | --- |
| `SUPABASE_URL` | Existing project URL |
| `SUPABASE_ANON_KEY` | Existing publishable/anon key |
| `GST_PROVIDER` | `http-gsp` |
| `GST_MODE` | `sandbox` initially; `production` only for live submissions |
| `GST_SANDBOX_URL` | HTTPS bridge base URL for the GSP sandbox |
| `GST_PROVIDER_URL` | HTTPS bridge base URL for production |
| `GST_API_KEY` | Bridge API credential |
| `GST_OWNER_EMAILS` | Optional comma-separated allowlist for legacy owner accounts |

`POST <base>/generate` receives `{ kind: "irn" | "ewb", payload, idempotency_key }` and must return `{ id, generated_at, ack_no?, signed_qr? }`. IRN responses must contain acknowledgement and signed QR. `generated_at` must be an ISO timestamp including timezone. The bridge must honour idempotency keys, including retries after network or database failure. `POST <base>/cancel` receives `{ kind, id, reason }`, maps the reason to the vendor's cancellation code/remarks and returns JSON on success. Authorization is `Bearer GST_API_KEY`. Native NIC encryption/authentication belong in the vendor adapter/bridge.

The server fetches the saved invoice and profile, checks owner authorization and generates the payload itself. Sync an invoice before submission. Submission and cancellation require internet. Sandbox acknowledgements are marked on printouts. An active EWB must be cancelled before its IRN; both cancellation windows use the provider timestamp and expire at 24 hours. Cancellation of a government registration does not automatically void the local financial document.

References: [NIC EWB API](https://docs.ewaybillgst.gov.in/apidocs/version1.03/generate-eway-bill.html), [notified e-invoice schema](https://einvoice6.gst.gov.in/content/notified-e-invoice-schema/), [IRP cancellation rules](https://einvoice6.gst.gov.in/content/faq-powered-by-irisirp/).

## Banking and Migration

Bank CSV/XLSX imports detect common SBI/HDFC/ICICI-style headings and allow mapping changes. Amounts use exact paise; suggestions require direction and a date within three days, then prefer reference/party matches. Ties require manual review. Manual matching can reconcile older dates but still requires the same amount and direction. Re-imports skip matching statement fingerprints. Identical lines in one statement are preserved by occurrence count; overlapping statements without transaction references may still need manual review.

The import wizard accepts CSV, XLSX and Tally master XML (STOCKITEM, LEDGER, opening balances and batch/godown allocations). Legacy `.xls` must be saved as `.xlsx` or CSV. Tally debtor/creditor balances are translated into the app's customer/supplier conventions. Unsupported Tally vouchers are not imported as invoices. Source duplicate keys block import, existing master keys are shown as updates, and the complete file saves in one IndexedDB transaction. Undo restores the last batch only and refuses records subsequently edited or used in stock/financial activity.

## Owner Security and Printing

Settings → Owner two-step login enrols a Supabase TOTP authenticator and verifies a code before enabling. Each new device requires a code. Verified devices remain usable offline; changing the security version invalidates old local trust. Provider submission still requires a current authenticated session and, when enabled, `aal2` assurance. Local PIN/device trust is an offline access control, not encryption against someone who can inspect the browser's files. The app never saves the authenticator secret in IndexedDB.

Settings → Printing selects 58 mm or 80 mm thermal paper per device. Both print IRN/acknowledgement, signed QR and EWB details. Actual paper margins depend on the printer driver; use matching paper width and disable browser headers/footers.

## Verification

Run `npm test`, `npm run build` and `node node_modules/typescript/bin/tsc -p tsconfig.phase3-api.json`. The Supabase migration is supplied for you to run; no production database change is made automatically. Live provider submission and real authenticator delivery need your configured accounts.
