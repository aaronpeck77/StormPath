/**
 * Prepare App Store / PWA icons from a master PNG (preferred) or SVG fallback.
 *
 * Drop YOUR artwork here (1024×1024 PNG or larger square):
 *   web/assets/stormpath-app-icon-master.png
 * Committed rainbow artwork from last night:
 *   web/assets/stormpath-app-icon-master-rainbow.png  →  npm run render:app-icon:rainbow
 *
 * iOS requires opaque RGB 1024×1024 — flattened onto #0a0b0d.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const svgPath = path.join(webRoot, "assets", "stormpath-app-icon.svg");
const masterName =
  process.argv[2] === "rainbow"
    ? "stormpath-app-icon-master-rainbow.png"
    : process.env.APP_ICON_MASTER?.trim() || "stormpath-app-icon-master.png";
const masterPath = path.join(webRoot, "assets", masterName);
const outMaster = path.join(webRoot, "assets", "stormpath-app-icon-1024.png");
const iosIcon = path.join(
  webRoot,
  "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"
);
const iconsDir = path.join(webRoot, "public", "icons");
const ICON_BG = "#0a0b0d";
const IOS_SIZE = 1024;
const MAX_IOS_ICON_BYTES = 512 * 1024;

async function writeIosIcon(buffer, dest, { colorful = false } = {}) {
  let pipeline = sharp(buffer)
    .resize(IOS_SIZE, IOS_SIZE, {
      fit: "contain",
      background: ICON_BG,
    })
    .flatten({ background: ICON_BG });

  // Palette mode dulls rainbow gradients — keep truecolor for photo-style masters.
  pipeline = pipeline.png(
    colorful
      ? { compressionLevel: 9, effort: 10 }
      : { compressionLevel: 9, palette: true, effort: 10 }
  );

  const out = await pipeline.toBuffer();
  fs.writeFileSync(dest, out);

  const meta = await sharp(out).metadata();
  if (meta.hasAlpha) {
    throw new Error(`${dest} still has alpha after flatten — App Store requires opaque RGB.`);
  }
  if (out.length > MAX_IOS_ICON_BYTES) {
    console.warn(
      `Warning: iOS app icon is ${(out.length / 1024).toFixed(0)} KB (>${MAX_IOS_ICON_BYTES / 1024} KB).`
    );
  }
  return out.length;
}

async function fromMaster() {
  const colorful = /rainbow|master-rainbow/i.test(masterName);
  const bytes = await writeIosIcon(
    await fs.promises.readFile(masterPath),
    outMaster,
    { colorful }
  );
  fs.copyFileSync(outMaster, iosIcon);

  for (const dest of [
    path.join(iconsDir, "icon-512.png"),
    path.join(iconsDir, "icon-maskable-512.png"),
  ]) {
    fs.copyFileSync(outMaster, dest);
  }

  const icon192 = await sharp(outMaster)
    .resize(192, 192, { fit: "contain", background: ICON_BG })
    .flatten({ background: ICON_BG })
    .png({ compressionLevel: 9 })
    .toBuffer();
  fs.writeFileSync(path.join(iconsDir, "icon-192.png"), icon192);

  console.log(`App icon from master ${masterName}:`);
  console.log(`  ${outMaster} (${(bytes / 1024).toFixed(0)} KB, opaque RGB)`);
  console.log(`  ${iosIcon}`);
  console.log(`  ${iconsDir}`);
}

async function fromSvg() {
  const svg = fs.readFileSync(svgPath, "utf8");
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: IOS_SIZE },
    background: ICON_BG,
  });
  const bytes = await writeIosIcon(resvg.render().asPng(), outMaster);
  fs.copyFileSync(outMaster, iosIcon);
  for (const dest of [
    path.join(iconsDir, "icon-512.png"),
    path.join(iconsDir, "icon-maskable-512.png"),
  ]) {
    fs.copyFileSync(outMaster, dest);
  }
  const icon192 = await sharp(outMaster).resize(192, 192).png().toBuffer();
  fs.writeFileSync(path.join(iconsDir, "icon-192.png"), icon192);
  console.log(`App icon from SVG fallback (${(bytes / 1024).toFixed(0)} KB):`);
  console.log(`  ${iosIcon}`);
}

if (fs.existsSync(masterPath)) {
  await fromMaster();
} else if (fs.existsSync(svgPath)) {
  console.warn(`Master not found (${masterPath}); using SVG fallback.`);
  await fromSvg();
} else {
  console.error("No app icon master PNG or SVG found.");
  process.exit(1);
}
