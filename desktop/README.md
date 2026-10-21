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

## Build a new version
GitHub → Actions → **Windows desktop app** → Run workflow → enter a version (e.g. `1.0.1`). Or push a tag `desktop-v1.0.1`. The release appears with the installer and zip, and open apps offer the update.
