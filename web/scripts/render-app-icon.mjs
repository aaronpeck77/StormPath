/**
 * Renders stormpath-app-icon.svg (same art as StormIdleIllustration) to 1024 PNG
 * and copies into iOS + PWA icon slots.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const svgPath = path.join(webRoot, "assets", "stormpath-app-icon.svg");
const outMaster = path.join(webRoot, "assets", "stormpath-app-icon-1024.png");
const iosIcon = path.join(
  webRoot,
  "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"
);
const iconsDir = path.join(webRoot, "public", "icons");

const svg = fs.readFileSync(svgPath, "utf8");
const resvg = new Resvg(svg, {
  fitTo: { mode: "width", value: 1024 },
  background: "#0a0b0d",
});
const png = resvg.render().asPng();
fs.writeFileSync(outMaster, png);

for (const dest of [
  iosIcon,
  path.join(iconsDir, "icon-512.png"),
  path.join(iconsDir, "icon-maskable-512.png"),
]) {
  fs.copyFileSync(outMaster, dest);
}

const resvg192 = new Resvg(svg, {
  fitTo: { mode: "width", value: 192 },
  background: "#0a0b0d",
});
fs.writeFileSync(path.join(iconsDir, "icon-192.png"), resvg192.render().asPng());

console.log("App icon rendered from SVG:");
console.log("  ", outMaster);
console.log("  ", iosIcon);
console.log("  ", iconsDir);
