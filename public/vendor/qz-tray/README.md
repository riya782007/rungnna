# QZ Tray browser connector

Unmodified browser client from the official QZ Industries repository, release
tag `v2.3.0`. It is loaded from this app's own origin only when direct label
printing or printer discovery is requested. It is also included in the app's
normal offline precache.

- Source: https://github.com/qzind/tray/blob/v2.3.0/js/qz-tray.js
- Download: https://raw.githubusercontent.com/qzind/tray/v2.3.0/js/qz-tray.js
- SHA-256: `2516fe196e7b7db0ae10a6c90f6210f08d8bc52a65d203d70795637d2c4340be`
- License: LGPL-2.1-only; official attribution and license text in `LICENSE.txt`.
- License source: https://github.com/qzind/tray/blob/v2.3.0/LICENSE.txt

The release file's public header says 2.3.0; its internal `VERSION` is 2.2.6 in
upstream. The file is intentionally retained without edits. Replace this file
with a compatible version to update or modify the connector.

QZ Tray must be installed and running on the printer computer. This integration
uses unsigned mode and therefore retains QZ Tray's approval prompts. A trusted
signing certificate and server-side signing service would be needed to remove
those prompts; no certificate, private key, or remote signing service is bundled.

Transport reference: https://qz.io/docs/raw (raw command, base64 flavor).
Connection reference: https://qz.io/api/qz.websocket.
Printer discovery reference: https://qz.io/api/qz.printers.
Signing reference: https://qz.io/docs/signing-examples.
