/**
 * Renders stormpath-app-icon.svg (same art as StormIdleIllustration) to 1024 PNG
 * and copies into iOS + PWA icon slots.
 *
 * iOS App Store icons must be opaque RGB (no alpha) — RGBA icons can upload but
 * fail Apple processing and never appear in TestFlight.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const svgPath = path.join(webRoot, "assets", "stormpath-app-icon.svg");
const outMaster = path.join(webRoot, "assets", "stormpath-app-icon-1024.png");
const iosIcon = path.join(
  webRoot,
  "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"
);
const iconsDir = path.join(webRoot, "public", "icons");
const ICON_BG = "#0a0b0d";
const MAX_IOS_ICON_BYTES = 512 * 1024;

const svg = fs.readFileSync(svgPath, "utf8");

async function renderPng(width, dest, { iosAppStore = false } = {}) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    background: ICON_BG,
  });
  let pipeline = sharp(resvg.render().asPng()).flatten({ background: ICON_BG });

  if (iosAppStore) {
    pipeline = pipeline.png({
      compressionLevel: 9,
      palette: true,
      effort: 10,
    });
  } else {
    pipeline = pipeline.png({ compressionLevel: 9 });
  }

  const out = await pipeline.toBuffer();
  fs.writeFileSync(dest, out);

  if (iosAppStore) {
    const meta = await sharp(out).metadata();
    if (meta.hasAlpha) {
      throw new Error("iOS app icon still has alpha after flatten — App Store requires opaque RGB.");
    }
    if (out.length > MAX_IOS_ICON_BYTES) {
      console.warn(
        `Warning: iOS app icon is ${(out.length / 1024).toFixed(0)} KB (>${MAX_IOS_ICON_BYTES / 1024} KB). Consider simplifying SVG.`
      );
    }
  }

  return out.length;
}

const masterBytes = await renderPng(1024, outMaster, { iosAppStore: true });
fs.copyFileSync(outMaster, iosIcon);

for (const dest of [
  path.join(iconsDir, "icon-512.png"),
  path.join(iconsDir, "icon-maskable-512.png"),
]) {
  fs.copyFileSync(outMaster, dest);
}

await renderPng(192, path.join(iconsDir, "icon-192.png"));

console.log("App icon rendered from SVG (opaque RGB for iOS):");
console.log(`  ${outMaster} (${(masterBytes / 1024).toFixed(0)} KB)`);
console.log(`  ${iosIcon}`);
console.log(`  ${iconsDir}`);
