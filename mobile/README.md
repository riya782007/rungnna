# Rungnna Shop OS — Android app

The same app as the website, built as an Android app with Capacitor. The Android project is generated in CI (`npx cap add android`), then `scripts/prepare-android.cjs` adds:
- permissions: camera, microphone, Bluetooth;
- the print bridge `android-src/RjPrintPlugin.java`, which sends bills to Android's print service or "Save as PDF";
- version and signing.

- **Offline:** all screens are inside the APK. Data is saved on the phone first and synced when online.
- **Server features** (AI, GST, photo upload) call the live site. CORS for `https://localhost` is set in `vercel.json`.
- **Bluetooth stickers:** Labels → Printer settings → TSC / TSPL → **Connect Bluetooth printer**. Needs a BLE label printer that speaks TSPL.

## Signing
`rungnna-test.jks` (passwords `rungnna-test`, alias `rungnna`) is a **test key**, so test builds update over each other. Before giving the app to staff, make a private key and add repository secrets:
- `ANDROID_KEYSTORE_BASE64` (the .jks, base64)
- `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`

Changing the key means uninstalling the test app once. Sync first so nothing is lost.

## Build
GitHub → Actions → **Apps (Windows + Android)** → Run workflow. Or push tag `apps-v1.0.1`.
