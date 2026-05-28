/**
 * Minimal processing: crop off rounded card edges, scale to 1024.
 * No color replacement — storm art stays exactly as drawn.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcPath = path.join(webRoot, "assets", "stormpath-app-icon-source.png");
const outMaster = path.join(webRoot, "assets", "stormpath-app-icon-master.png");
const outStorm = path.join(webRoot, "assets", "stormpath-app-icon-storm-only.png");

if (!fs.existsSync(srcPath)) {
  console.error(`Missing source: ${srcPath}`);
  process.exit(1);
}

const meta = await sharp(srcPath).metadata();
const side = Math.min(meta.width, meta.height);
const left = Math.floor((meta.width - side) / 2);
const top = Math.floor((meta.height - side) / 2);
const inset = Math.round(side * 0.14);
const crop = side - inset * 2;

const master = await sharp(srcPath)
  .extract({ left: left + inset, top: top + inset, width: crop, height: crop })
  .resize(1024, 1024, { kernel: sharp.kernel.lanczos3 })
  .flatten({ background: "#5EB8E8" })
  .png({ compressionLevel: 9, effort: 10 })
  .toBuffer();

fs.writeFileSync(outMaster, master);

const stormOnly = await sharp(srcPath)
  .extract({ left: left + inset, top: top + inset, width: crop, height: crop })
  .resize(1024, 1024, { kernel: sharp.kernel.lanczos3 })
  .png({ compressionLevel: 9 })
  .toBuffer();

fs.writeFileSync(outStorm, stormOnly);

console.log(`Saved (crop only, no color edits):`);
console.log(`  ${outMaster}`);
console.log(`  ${outStorm}`);
