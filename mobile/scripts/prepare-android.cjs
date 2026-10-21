// After `npx cap add android`: permissions, version and signing for the Rungnna Android app.
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..", "android");
const version = process.env.APP_VERSION || "1.0.0";
const code = Number(process.env.APP_VERSION_CODE || 1);

// 1. Permissions: internet, camera (QR scan, photos), microphone (voice order), Bluetooth printer, vibration
const manifest = path.join(root, "app", "src", "main", "AndroidManifest.xml");
let m = fs.readFileSync(manifest, "utf8");
if (!m.includes("xmlns:tools")) m = m.replace("<manifest ", '<manifest xmlns:tools="http://schemas.android.com/tools" ');
const perms = `
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
    <uses-permission android:name="android.permission.VIBRATE" />
    <uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" tools:node="replace" />
    <uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" tools:node="replace" />
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" android:maxSdkVersion="30" tools:node="replace" />
    <uses-permission android:name="android.permission.BLUETOOTH_SCAN" android:usesPermissionFlags="neverForLocation" tools:targetApi="s" tools:node="replace" />
    <uses-permission android:name="android.permission.BLUETOOTH_CONNECT" tools:node="replace" />
    <uses-feature android:name="android.hardware.camera" android:required="false" />
    <uses-feature android:name="android.hardware.bluetooth_le" android:required="false" />
`;
m = m.replace(/<uses-permission android:name="android\.permission\.INTERNET" \/>\s*/g, "");
m = m.replace(/(<manifest[^>]*>)/, `$1${perms}`);
// keep the screen awake-friendly and stop rotations from reloading a bill
m = m.replace(/android:configChanges="([^"]*)"/, (_x, v) => `android:configChanges="${v.includes("screenSize") ? v : v + "|screenSize"}"`);
fs.writeFileSync(manifest, m);

// 2. Version and release signing (stable key so updates install over the old app, keeping its data)
const gradle = path.join(root, "app", "build.gradle");
let g = fs.readFileSync(gradle, "utf8");
g = g.replace(/versionCode \d+/, `versionCode ${code}`).replace(/versionName "[^"]*"/, `versionName "${version}"`);
const ks = process.env.KEYSTORE_FILE;
if (ks && !g.includes("signingConfigs {")) {
  g = g.replace(/buildTypes \{/, `signingConfigs {
        release {
            storeFile file("${ks.replace(/\\/g, "/")}")
            storePassword System.getenv("KEYSTORE_PASSWORD")
            keyAlias System.getenv("KEY_ALIAS")
            keyPassword System.getenv("KEY_PASSWORD")
        }
    }
    buildTypes {`);
  g = g.replace(/release \{\s*minifyEnabled false/, "release {\n            signingConfig signingConfigs.release\n            minifyEnabled false");
}
fs.writeFileSync(gradle, g);
console.log("android prepared", version, code, ks ? "signed" : "unsigned");

// 3. The print bridge (RjPrintPlugin) and its registration in MainActivity
const pkgDir = path.join(root, "app", "src", "main", "java", "in", "rungnna", "shopos");
fs.mkdirSync(pkgDir, { recursive: true });
for (const f of ["RjPrintPlugin.java", "RjUpdatePlugin.java"]) fs.copyFileSync(path.join(__dirname, "..", "android-src", f), path.join(pkgDir, f));
const main = path.join(pkgDir, "MainActivity.java");
fs.writeFileSync(main, `package in.rungnna.shopos;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        RjUpdatePlugin.watchdog(getApplicationContext());   // roll back an update that never started
        registerPlugin(RjPrintPlugin.class);
        registerPlugin(RjUpdatePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
`);
console.log("print + update bridges added");
