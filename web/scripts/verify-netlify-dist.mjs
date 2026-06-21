/**
 * Post-build checks for Netlify drag-and-drop deploys.
 * Ensures _headers allows Tomorrow.io and PWA icons are present before upload.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(webRoot, "dist");
const headersPath = path.join(distDir, "_headers");
const iconPath = path.join(distDir, "icons", "icon-192.png");
const checkPath = path.join(distDir, "_deploy-check.txt");

function fail(msg) {
  console.error(`\n  NETLIFY BUILD CHECK FAILED: ${msg}\n`);
  process.exit(1);
}

if (!fs.existsSync(distDir)) {
  fail('dist/ folder missing — run "npm run build" first.');
}

if (!fs.existsSync(headersPath)) {
  fail("_headers missing from dist/. It must be copied from public/ during the Vite build.");
}

const headers = fs.readFileSync(headersPath, "utf8");
if (!headers.includes("https://weatherkit.apple.com")) {
  fail("dist/_headers does not allow https://weatherkit.apple.com in connect-src.");
}
if (!headers.includes("https://api.tomorrow.io")) {
  fail('dist/_headers does not allow https://api.tomorrow.io in connect-src.');
}

if (!fs.existsSync(iconPath)) {
  fail("dist/icons/icon-192.png missing — manifest and favicon will 404 on Netlify.");
}

const stamp = new Date().toISOString();
const mapboxAtBuild = Boolean(process.env.VITE_MAPBOX_TOKEN?.trim());
const weatherKitAtBuild =
  String(process.env.VITE_WEATHERKIT_ENABLED ?? "").toLowerCase() === "true";
const checkBody = [
  "StormPath Netlify deploy verification",
  `built_at=${stamp}`,
  `mapbox_token=${mapboxAtBuild ? "baked" : "MISSING"}`,
  `weatherkit_enabled=${weatherKitAtBuild ? "yes" : "no"}`,
  "csp_weatherkit=yes",
  "csp_tomorrow_io=yes",
  "icons=yes",
  "",
  "If mapbox_token=MISSING: Netlify → Environment variables → VITE_MAPBOX_TOKEN",
  "  scope must include Builds, then Trigger deploy.",
  "",
  "After deploy, open:",
  "  https://stormpath2.netlify.app/_deploy-check.txt",
  "",
].join("\n");

fs.writeFileSync(checkPath, checkBody, "utf8");

console.log("Netlify dist verified:");
console.log("  - dist/_headers includes weatherkit.apple.com");
console.log("  - dist/_headers includes api.tomorrow.io");
console.log("  - dist/icons/icon-192.png present");
console.log(`  - dist/_deploy-check.txt written (${stamp})`);
