/**
 * iOS App Store requires AppIcon-512@2x.png to be exactly 1024×1024.
 * Non-square icons (e.g. 1536×1024 from image generators) fail xcodebuild archive.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const iosIcon = path.join(
  webRoot,
  "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"
);

if (!fs.existsSync(iosIcon)) {
  console.error(`Missing iOS app icon: ${iosIcon}`);
  process.exit(1);
}

const buf = fs.readFileSync(iosIcon);
if (buf.length < 24 || buf.toString("ascii", 1, 4) !== "PNG") {
  console.error("iOS app icon is not a valid PNG.");
  process.exit(1);
}

const width = buf.readUInt32BE(16);
const height = buf.readUInt32BE(20);

if (width !== 1024 || height !== 1024) {
  console.error(
    `iOS app icon must be 1024×1024; got ${width}×${height}. Center-crop or re-export before push.`
  );
  process.exit(1);
}

console.log(`iOS app icon OK: ${width}×${height}`);
