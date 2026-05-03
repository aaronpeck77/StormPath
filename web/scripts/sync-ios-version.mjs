/**
 * Keeps Xcode MARKETING_VERSION / CURRENT_PROJECT_VERSION in sync with web/package.json
 * so TestFlight / Settings match the in-app semver from Vite (__APP_VERSION__).
 *
 * Build number = major*1_000_000 + minor*1000 + patch (monotonic with semver bumps).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(__dirname, "..");
const pkgPath = path.join(webRoot, "package.json");
const pbxPath = path.join(webRoot, "ios", "App", "App.xcodeproj", "project.pbxproj");

const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const version = String(pkg.version || "0.0.0").trim();
const parts = version.split(".").map((x) => parseInt(x, 10));
const maj = Number.isFinite(parts[0]) ? parts[0] : 0;
const min = Number.isFinite(parts[1]) ? parts[1] : 0;
const pat = Number.isFinite(parts[2]) ? parts[2] : 0;
const marketingVersion = version;
const buildNumber = maj * 1_000_000 + min * 1000 + pat;

let pbx = fs.readFileSync(pbxPath, "utf8");
pbx = pbx.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${marketingVersion};`);
pbx = pbx.replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${buildNumber};`);
fs.writeFileSync(pbxPath, pbx);
console.log(
  `sync-ios-version: MARKETING_VERSION=${marketingVersion}, CURRENT_PROJECT_VERSION=${buildNumber}`,
);
