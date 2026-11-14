# Rungnna Shop OS — Windows app

The same app as the website, packed as a Windows program. Every screen works the same. Billing, stock and labels work with **no internet**. Bills are saved on the computer first, then synced to the cloud when the internet is back.

## Install
Download from the repository's **Releases** page (latest `desktop-v…`):
- `Rungnna-Shop-OS-Setup-<version>.exe`: installer with desktop and Start-menu icons (recommended), or
- `Rungnna-Shop-OS-<version>-x64.zip`: unzip anywhere and run `Rungnna Shop OS.exe`.

The first time, Windows may say "Windows protected your PC" (the app isn't code-signed). Click **More info → Run anyway**.

## First start
Sign in to cloud backup once (Settings → Cloud backup) so the shop's products, customers and bills download to this computer. After that the app runs offline.

## What needs the internet
Cloud sync, AI bill reading, Ask, GST e-invoice / e-way bill, and photo upload. These use the live server and work again as soon as the internet is back. Everything else works offline.

## Label printer
USB/serial TSC printers work as in Chrome. Bluetooth (BLE) label printers: Labels → Printer settings → TSC / TSPL → **Connect Bluetooth printer** → pick it from the list.

## Updates
Fixes arrive **automatically**, the same day they go live on the website. The app looks for a new version every 10 minutes (and when you come back to the computer), downloads only the changed files, checks each one, and switches to it **the next time the app is opened** — or straight away from the **"New version ready → Update"** bar, or when the app is left on Home or the sign-in screen. A bill in progress is never interrupted. A version that fails to start is rolled back by itself.

**Settings → Backup & devices → This app** shows the app's version, the website's version, when it last looked and, if it could not update, why — with **Check now**. If the app stays behind the website, a bar says "This app has an older version".

People, PINs, the shop passcode and every setting come from the cloud like bills do, once the computer is connected (it connects by itself when the shop's entry code is typed with internet on).

Installers from before 14 Nov 2026 (app 1.0.x) only switch while running; install the new installer once and every update after that is automatic. A newer installer is offered by the app itself ("Update available").

## Build a new installer
GitHub → Actions → **Apps (Windows + Android)** → Run workflow → enter a version (e.g. `1.0.1`). Or push a tag `apps-v1.0.1`. The release appears with the installer and zip, and open apps offer the update.
