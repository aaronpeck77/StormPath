/**
 * iOS App Store requires AppIcon-512@2x.png to be exactly 1024×1024 opaque RGB.
 * Non-square or RGBA icons fail archive or Apple post-upload processing.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const iosIcon = path.join(
  webRoot,
  "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"
);
const MAX_BYTES = 512 * 1024;

if (!fs.existsSync(iosIcon)) {
  console.error(`Missing iOS app icon: ${iosIcon}`);
  process.exit(1);
}

const meta = await sharp(iosIcon).metadata();
const { width, height, hasAlpha } = meta;
const size = fs.statSync(iosIcon).size;

if (width !== 1024 || height !== 1024) {
  console.error(
    `iOS app icon must be 1024×1024; got ${width}×${height}. Run npm run render:app-icon.`
  );
  process.exit(1);
}

if (hasAlpha) {
  console.error(
    "iOS app icon must be opaque RGB (no alpha). RGBA icons can pass GitHub CI but fail Apple TestFlight processing. Run npm run render:app-icon."
  );
  process.exit(1);
}

if (size > MAX_BYTES) {
  console.error(
    `iOS app icon is ${Math.round(size / 1024)} KB; keep under ${MAX_BYTES / 1024} KB. Run npm run render:app-icon.`
  );
  process.exit(1);
}

console.log(`iOS app icon OK: ${width}×${height}, opaque RGB, ${Math.round(size / 1024)} KB`);
