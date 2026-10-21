// Renders the app icon (public/icon.svg) to the 512px PNG the Windows build needs.
const fs = require("node:fs");
const path = require("node:path");
const { Resvg } = require("@resvg/resvg-js");
const svg = fs.readFileSync(path.join(__dirname, "..", "public", "icon.svg"));
const png = new Resvg(svg, { fitTo: { mode: "width", value: 512 }, font: { loadSystemFonts: true, defaultFontFamily: "Georgia" } }).render().asPng();
fs.mkdirSync(path.join(__dirname, "build"), { recursive: true });
fs.writeFileSync(path.join(__dirname, "build", "icon.png"), png);
console.log("icon.png", png.length, "bytes");
