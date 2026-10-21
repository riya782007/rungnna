// Writes dist/app-build.json: the list of every file in this web build with its SHA-256.
// The Windows and Android apps read it from the live site to update themselves (no reinstall):
// they download a new build only when `id` changes, and check every file against its hash.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

/* The app version (Windows installer / Android APK) these screens need. Raise it only when the
   screens start using something new in desktop/main.cjs, preload.cjs or the Android plugins:
   older apps then keep their current screens and offer the new installer instead. */
export const MIN_SHELL = 1;

const SKIP = /^(app-build\.json|sw\.js|registerSW\.js|workbox-[^/]*\.js|manifest\.webmanifest)$|\.map$/;

export function buildManifest(dir) {
  const files = [];
  const walk = d => {
    for (const name of readdirSync(d).sort()) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      const path = relative(dir, full).split(sep).join("/");
      if (SKIP.test(path)) continue;
      const bytes = readFileSync(full);
      files.push({ path, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
    }
  };
  walk(dir);
  if (!files.some(f => f.path === "index.html")) throw new Error("app-build: index.html missing from " + dir);
  const id = createHash("sha256").update(files.map(f => f.path + ":" + f.sha256).join("\n")).digest("hex").slice(0, 16);
  return { id, built: new Date().toISOString(), minShell: MIN_SHELL, files };
}

export function writeManifest(dir) {
  const m = buildManifest(dir);
  writeFileSync(join(dir, "app-build.json"), JSON.stringify(m));
  return m;
}

export const appBuildManifest = () => ({
  name: "app-build-manifest",
  apply: "build",
  enforce: "post",
  closeBundle: { order: "post", sequential: true, handler() { const m = writeManifest("dist"); console.log(`app-build.json ${m.id} · ${m.files.length} files`); } },
});
