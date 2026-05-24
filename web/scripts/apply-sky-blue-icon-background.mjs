/**
 * Replace rainbow ring background in stormpath-app-icon-master-rainbow.png
 * with a sky-blue gradient, keeping cloud / lightning / rain pixels.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcPath = path.join(webRoot, "assets", "stormpath-app-icon-master-rainbow.png");
const outPath = path.join(webRoot, "assets", "stormpath-app-icon-master.png");

function clamp255(n) {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function skyBlueAt(x, y, width, height) {
  const t = y / Math.max(1, height - 1);
  const top = { r: 0x8f, g: 0xd4, b: 0xff };
  const bottom = { r: 0x4a, g: 0x9f, b: 0xd9 };
  const cx = (x - width / 2) / (width / 2);
  const cy = (y - height / 2) / (height / 2);
  const radial = Math.min(1, Math.hypot(cx, cy));
  const lift = (1 - radial * 0.22) * 18;

  return {
    r: clamp255(top.r * (1 - t) + bottom.r * t + lift),
    g: clamp255(top.g * (1 - t) + bottom.g * t + lift),
    b: clamp255(top.b * (1 - t) + bottom.b * t + lift),
  };
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
  return { h, s, l };
}

function blendOverSky(r, g, b, a, sky) {
  const t = a / 255;
  return {
    r: clamp255(r * t + sky.r * (1 - t)),
    g: clamp255(g * t + sky.g * (1 - t)),
    b: clamp255(b * t + sky.b * (1 - t)),
  };
}

/** Saturated rainbow ring arcs — never storm art (bolt core exempt for yellow). */
function isRainbowRingColor(hue, s, l, nx, ny) {
  if (s < 0.38 || l < 0.32 || l > 0.92) return false;

  const inBoltCore = nx < 0.09 && ny >= 0.24 && ny <= 0.58;

  if (hue <= 68) return !inBoltCore;
  if (hue <= 155) return true;
  if (hue >= 265 && hue <= 340) return true;
  return false;
}

/** Cloud, lightning bolt, and rain streaks only (tight spatial mask on bolt). */
function isStormArt(r, g, b, a, x, y, width, height) {
  if (a < 8) return false;

  const { h, s, l } = hsl(r, g, b);
  const hue = h * 360;
  const nx = Math.abs(x / width - 0.5);
  const ny = y / height;

  if (isRainbowRingColor(hue, s, l, nx, ny)) return false;

  const inCloudBand = ny >= 0.1 && ny <= 0.44 && nx < 0.32;
  const inRainBand = ny > 0.4 && ny < 0.76 && nx < 0.34;
  const inBoltBand = nx < 0.1 && ny > 0.2 && ny < 0.62;

  // Dark storm cloud / rain — only inside the art bands, not outer vignette
  if (l < 0.27) {
    return inCloudBand || inRainBand || inBoltBand;
  }
  if (l < 0.4 && s < 0.38) {
    return inCloudBand || inRainBand;
  }

  // Lightning — narrow center column, vertical bolt only
  if (inBoltBand) {
    if (l > 0.7 && Math.max(r, g, b) > 180) return true;
    if (l > 0.55 && s > 0.3 && hue >= 38 && hue <= 72) return true;
    if (l > 0.5 && s > 0.2 && hue >= 168 && hue <= 212 && b >= g - 10) return true;
  }

  // Rain under cloud
  if (inRainBand) {
    if (b >= r - 4 && b > 65 && s > 0.1 && l > 0.25) return true;
  }

  return false;
}

if (!fs.existsSync(srcPath)) {
  console.error(`Missing source icon: ${srcPath}`);
  process.exit(1);
}

const { data, info } = await sharp(srcPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height, channels } = info;
const out = Buffer.from(data);

let replaced = 0;
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const i = (y * width + x) * channels;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    const sky = skyBlueAt(x, y, width, height);

    if (isStormArt(r, g, b, a, x, y, width, height)) {
      const px = blendOverSky(r, g, b, a, sky);
      out[i] = px.r;
      out[i + 1] = px.g;
      out[i + 2] = px.b;
      out[i + 3] = 255;
    } else {
      out[i] = sky.r;
      out[i + 1] = sky.g;
      out[i + 2] = sky.b;
      out[i + 3] = 255;
      replaced++;
    }
  }
}

await sharp(out, { raw: { width, height, channels } })
  .png({ compressionLevel: 9 })
  .toFile(outPath);

console.log(`Sky-blue icon master written: ${outPath}`);
console.log(`  Sky background: ${replaced} px (${((replaced / (width * height)) * 100).toFixed(1)}%)`);
