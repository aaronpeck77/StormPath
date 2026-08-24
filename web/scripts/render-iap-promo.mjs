/**
 * Flatten StormPath Plus IAP promotional images to Apple's 1024×1024 RGB PNG spec.
 *
 *   node scripts/render-iap-promo.mjs
 *
 * Output:
 *   web/assets/store/stormpath-plus-promo-monthly.png
 *   web/assets/store/stormpath-plus-promo-yearly.png
 *
 * Spec: JPG/PNG, 1024×1024, 72 dpi, RGB, flattened, no rounded corners.
 * Must not match the app icon. Monthly and yearly must not match each other.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const storeDir = path.join(webRoot, "assets", "store");
const SIZE = 1024;

const jobs = [
  {
    svg: "stormpath-plus-promo-monthly.svg",
    png: "stormpath-plus-promo-monthly.png",
    flatten: "#070B14",
  },
  {
    svg: "stormpath-plus-promo-yearly.svg",
    png: "stormpath-plus-promo-yearly.png",
    flatten: "#0B0908",
  },
];

async function renderOne({ svg, png, flatten }) {
  const svgPath = path.join(storeDir, svg);
  const pngPath = path.join(storeDir, png);
  const rendered = new Resvg(fs.readFileSync(svgPath), {
    fitTo: { mode: "width", value: SIZE },
  }).render();
  const out = await sharp(rendered.asPng())
    .resize(SIZE, SIZE, { fit: "fill" })
    .flatten({ background: flatten })
    .png({ compressionLevel: 9, effort: 10 })
    .toBuffer();
  const meta = await sharp(out).metadata();
  if (meta.width !== SIZE || meta.height !== SIZE) {
    throw new Error(`${png} is ${meta.width}×${meta.height}, need ${SIZE}×${SIZE}`);
  }
  if (meta.hasAlpha) {
    throw new Error(`${png} still has alpha — Apple wants flattened RGB`);
  }
  fs.writeFileSync(pngPath, out);
  console.log(`wrote ${path.relative(webRoot, pngPath)} (${(out.length / 1024).toFixed(0)} KB)`);
  return out;
}

const buffers = [];
for (const job of jobs) {
  buffers.push(await renderOne(job));
}

if (buffers[0].equals(buffers[1])) {
  throw new Error("monthly and yearly promo PNGs are identical");
}

console.log("ok: two distinct 1024×1024 IAP promotional images");
