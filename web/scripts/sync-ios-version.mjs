/**
 * Keeps Xcode MARKETING_VERSION / CURRENT_PROJECT_VERSION in sync with web/package.json
 * so TestFlight / Settings match the in-app semver from Vite (__APP_VERSION__).
 *
 * Build number = IOS_BUILD_NUMBER env (CI / TestFlight) or major*1_000_000 + minor*1000 + patch.
 *
 * Important: iOS compares MARKETING_VERSION when offering TestFlight/App Store updates.
 * If you ever shipped 1.0, do not ship 0.x next — testers on 1.0 will not see 0.x as an update
 * (0.7 < 1.0). Bump to at least 1.0.1 (or 2.0.0) before the next upload.
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
const envBuild = process.env.IOS_BUILD_NUMBER?.trim();
const buildNumber = envBuild && /^\d+$/.test(envBuild)
  ? envBuild
  : String(maj * 1_000_000 + min * 1000 + pat);

let pbx = fs.readFileSync(pbxPath, "utf8");
pbx = pbx.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${marketingVersion};`);
pbx = pbx.replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${buildNumber};`);
fs.writeFileSync(pbxPath, pbx);
console.log(
  `sync-ios-version: MARKETING_VERSION=${marketingVersion}, CURRENT_PROJECT_VERSION=${buildNumber}`,
);

/** Inject public Mapbox token into Info.plist for Navigation SDK (MBXAccessToken). */
function readViteMapboxToken() {
  const fromEnv = process.env.VITE_MAPBOX_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  for (const name of [".env.local", ".env"]) {
    const p = path.join(webRoot, name);
    if (!fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, "utf8");
    const m = text.match(/^\s*VITE_MAPBOX_TOKEN\s*=\s*(.+)\s*$/m);
    if (!m) continue;
    return m[1].replace(/^["']|["']$/g, "").trim();
  }
  return "";
}

const mapboxToken = readViteMapboxToken();
const plistPath = path.join(webRoot, "ios", "App", "App", "Info.plist");
if (mapboxToken && fs.existsSync(plistPath)) {
  let plist = fs.readFileSync(plistPath, "utf8");
  if (plist.includes("<key>MBXAccessToken</key>")) {
    plist = plist.replace(
      /(<key>MBXAccessToken<\/key>\s*<string>)[^<]*(<\/string>)/,
      `$1${mapboxToken}$2`,
    );
  } else {
    plist = plist.replace(
      "</dict>\n</plist>",
      `\t<key>MBXAccessToken</key>\n\t<string>${mapboxToken}</string>\n</dict>\n</plist>`,
    );
  }
  fs.writeFileSync(plistPath, plist);
  console.log("sync-ios-version: wrote MBXAccessToken to Info.plist");
} else if (!mapboxToken) {
  console.warn(
    "sync-ios-version: VITE_MAPBOX_TOKEN missing — add it before iOS Nav SDK builds",
  );
}
