import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { copyFileSync, mkdirSync } from "node:fs";

// Self-host the barcode/QR decoder so scanning works with zero internet.
const copyWasm = () => ({
  name: "copy-zxing-wasm",
  buildStart() {
    mkdirSync("public", { recursive: true });
    copyFileSync("node_modules/zxing-wasm/dist/reader/zxing_reader.wasm", "public/zxing_reader.wasm");
  },
});

export default defineConfig({
  plugins: [
    copyWasm(),
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg", "zxing_reader.wasm"],
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,wasm,woff2}"],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          { urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, handler: "CacheFirst",
            options: { cacheName: "fonts", expiration: { maxEntries: 20, maxAgeSeconds: 31536000 } } },
          { urlPattern: /^https:\/\/res\.cloudinary\.com\/.*/, handler: "CacheFirst",
            options: { cacheName: "photos", expiration: { maxEntries: 3000, maxAgeSeconds: 31536000 } } },
        ],
      },
      manifest: {
        name: "Rungnna Shop OS",
        short_name: "Rungnna",
        description: "Stock, racks, labels and billing for Rungnna Jewellery & Co",
        theme_color: "#241B2E",
        background_color: "#FAF6EF",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" },
        ],
      },
    }),
  ],
  build: { target: "es2020", chunkSizeWarningLimit: 1200 },
  test: { environment: "node" },
} as any);
