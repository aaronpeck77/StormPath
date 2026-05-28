/**
 * Composite storm icon from rainbow master:
 * - Keep original cloud, lightning, and rain from stormpath-app-icon-master-rainbow.png
 * - Replace rainbow / vignette with solid sky blue
 * - Recolor rain streaks to white / silver
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcPath = path.join(webRoot, "assets", "stormpath-app-icon-master-rainbow.png");
const outPath = path.join(webRoot, "assets", "stormpath-app-icon-master.png");

const SKY = { r: 0x5e, g: 0xb8, b: 0xe8 };

function clamp255(n) {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function hsl(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return { h: h * 360, s, l };
}

function silverRainAt(y, height) {
  const t = y / Math.max(1, height - 1);
  return {
    r: clamp255(255 - t * 18),
    g: clamp255(250 - t * 16),
    b: clamp255(242 - t * 12),
  };
}

function zones(x, y, width, height) {
  const nx = Math.abs(x / width - 0.5);
  const ny = y / height;
  return {
    nx,
    ny,
    inCloud: ny >= 0.14 && ny <= 0.46 && nx < 0.34,
    inRain: ny > 0.36 && ny < 0.78 && nx < 0.36,
    inBolt: nx < 0.09 && ny > 0.18 && ny < 0.62,
  };
}

function isRainbowColor(h, s, l) {
  if (s < 0.28 || l < 0.26 || l > 0.93) return false;
  if (h <= 168) return true;
  if (h >= 248 && h <= 345) return true;
  return false;
}

function isRain(r, g, b, z) {
  if (!z.inRain) return false;
  const { h, s, l } = hsl(r, g, b);
  if (isRainbowColor(h, s, l)) return false;
  return b >= r - 8 && b > g + 4 && b > 55 && s > 0.04 && l > 0.18 && l < 0.8 && h > 150 && h < 230;
}

function isCloud(r, g, b, z) {
  if (!z.inCloud) return false;
  const { h, s, l } = hsl(r, g, b);
  if (isRainbowColor(h, s, l)) return false;
  if (l < 0.52 && s < 0.6 && h > 190 && h < 290) return true;
  if (l < 0.62 && s < 0.38 && h > 200 && h < 265) return true;
  return false;
}

function isBolt(r, g, b, z) {
  if (!z.inBolt) return false;
  const { h, s, l } = hsl(r, g, b);
  if (isRainbowColor(h, s, l) && h <= 72) return false;
  if (l >= 0.68) return true;
  if (h >= 165 && h <= 215 && s > 0.12 && l > 0.42) return true;
  if (h <= 68 && s > 0.22 && l > 0.45) return true;
  return false;
}

function stormKind(r, g, b, x, y, width, height) {
  const z = zones(x, y, width, height);
  if (isRain(r, g, b, z)) return "rain";
  if (isCloud(r, g, b, z)) return "cloud";
  if (isBolt(r, g, b, z)) return "bolt";
  return "sky";
}

if (!fs.existsSync(srcPath)) {
  console.error(`Missing source icon: ${srcPath}`);
  process.exit(1);
}

const { data, info } = await sharp(srcPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height, channels } = info;
const out = Buffer.alloc(data.length);

const counts = { sky: 0, rain: 0, cloud: 0, bolt: 0 };

const kinds = new Uint8Array(width * height);
const KIND = { sky: 0, rain: 1, cloud: 2, bolt: 3 };

for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const i = (y * width + x) * channels;
    const kind = stormKind(data[i], data[i + 1], data[i + 2], x, y, width, height);
    kinds[y * width + x] = KIND[kind] ?? 0;
  }
}

// Fill small sky gaps inside the cloud band using neighboring storm pixels.
for (let y = 1; y < height - 1; y++) {
  for (let x = 1; x < width - 1; x++) {
    const p = y * width + x;
    if (kinds[p] !== KIND.sky) continue;
    const z = zones(x, y, width, height);
    if (!z.inCloud) continue;

    let cloudNeighbors = 0;
    let boltNeighbors = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = kinds[p + dy * width + dx];
      if (n === KIND.cloud) cloudNeighbors++;
      if (n === KIND.bolt) boltNeighbors++;
    }
    if (cloudNeighbors + boltNeighbors >= 2) {
      kinds[p] = boltNeighbors > cloudNeighbors ? KIND.bolt : KIND.cloud;
    }
  }
}

for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const p = y * width + x;
    const i = p * channels;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const kindNum = kinds[p];
    const kind =
      kindNum === KIND.rain ? "rain" : kindNum === KIND.cloud ? "cloud" : kindNum === KIND.bolt ? "bolt" : "sky";

    if (kind === "sky") {
      out[i] = SKY.r;
      out[i + 1] = SKY.g;
      out[i + 2] = SKY.b;
      out[i + 3] = 255;
      counts.sky++;
    } else if (kind === "rain") {
      const silver = silverRainAt(y, height);
      out[i] = silver.r;
      out[i + 1] = silver.g;
      out[i + 2] = silver.b;
      out[i + 3] = 255;
      counts.rain++;
    } else {
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      out[i + 3] = 255;
      counts[kind]++;
    }
  }
}

await sharp(out, { raw: { width, height, channels } })
  .png({ compressionLevel: 9 })
  .toFile(outPath);

console.log(`Storm icon composited: ${outPath}`);
console.log(`  Sky: ${counts.sky} px (${((counts.sky / (width * height)) * 100).toFixed(1)}%)`);
console.log(`  Rain → silver: ${counts.rain} px`);
console.log(`  Cloud (original): ${counts.cloud} px`);
console.log(`  Bolt (original): ${counts.bolt} px`);
