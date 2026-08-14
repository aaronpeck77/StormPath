/**
 * Fail the iOS / production web build if the baked bundle does not match the
 * requested track. Prevents submitting a TestFlight Plus IPA as the App Store
 * customer binary.
 *
 * Usage: node scripts/assert-ios-build-flavor.mjs appstore|testflight
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(webRoot, "dist");
const productionEnv = path.join(webRoot, ".env.production");
const testflightEnv = path.join(webRoot, ".env.testflight");

const track = (process.argv[2] || process.env.BUILD_TRACK || "").trim().toLowerCase();
if (track !== "appstore" && track !== "testflight") {
  console.error("Usage: node scripts/assert-ios-build-flavor.mjs appstore|testflight");
  process.exit(1);
}

function envFileHas(filePath, assignment) {
  if (!fs.existsSync(filePath)) return false;
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .some((line) => line.trim() === assignment);
}

function collectJs(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, name.name);
    if (name.isDirectory()) out.push(...collectJs(full));
    else if (name.isFile() && /\.(js|mjs|css|html)$/i.test(name.name)) {
      out.push(fs.readFileSync(full, "utf8"));
    }
  }
  return out;
}

if (!fs.existsSync(distDir)) {
  console.error(`Missing ${distDir}. Run the Vite build first.`);
  process.exit(1);
}

const blob = collectJs(distDir).join("\n");
const errors = [];

function requireStamp(stamp, why) {
  if (!blob.includes(stamp)) errors.push(`dist is missing ${stamp} (${why})`);
}

function forbidStamp(stamp, why) {
  if (blob.includes(stamp)) errors.push(`dist contains ${stamp} (${why})`);
}

if (track === "appstore") {
  requireStamp("STORMPATH_FLAVOR_STAMP_appstore", "customer IPA / production web");
  forbidStamp("STORMPATH_FLAVOR_STAMP_testflight", "that stamp means this is a TestFlight Plus bundle");
  requireStamp("STORMPATH_PLUS_FORCED_no", "customers must start Basic until IAP");
  forbidStamp("STORMPATH_PLUS_FORCED_yes", "forced Plus is TestFlight-only");
  requireStamp("STORMPATH_TEST_PANEL_no", "About test-tier panel must stay off");
  forbidStamp("STORMPATH_TEST_PANEL_yes", "test panel must not ship to App Store");
  requireStamp("STORMPATH_ADMOB_TEST_no", "live AdMob, not Google test creatives");
  forbidStamp("STORMPATH_ADMOB_TEST_yes", "AdMob test mode is TestFlight/QA only");
  if (envFileHas(productionEnv, "VITE_PAY_TIER=plus") || envFileHas(productionEnv, "VITE_PAY_TIER=pro")) {
    errors.push(".env.production sets VITE_PAY_TIER=plus — customer binary would skip IAP");
  }
  if (envFileHas(productionEnv, "VITE_PAY_TIER_TEST_PANEL=true")) {
    errors.push(".env.production enables VITE_PAY_TIER_TEST_PANEL");
  }
  if (envFileHas(productionEnv, "VITE_ADMOB_TEST_MODE=true")) {
    errors.push(".env.production enables VITE_ADMOB_TEST_MODE");
  }
} else {
  requireStamp("STORMPATH_FLAVOR_STAMP_testflight", "internal TestFlight Plus bundle");
  forbidStamp("STORMPATH_FLAVOR_STAMP_appstore", "appstore stamp on a testflight build");
  if (!envFileHas(testflightEnv, "VITE_PAY_TIER=plus") && !envFileHas(testflightEnv, "VITE_PAY_TIER=pro")) {
    errors.push(".env.testflight should set VITE_PAY_TIER=plus for internal testers");
  }
}

if (errors.length) {
  console.error(`iOS flavor check failed for track=${track}:`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(`iOS flavor OK: track=${track}`);
