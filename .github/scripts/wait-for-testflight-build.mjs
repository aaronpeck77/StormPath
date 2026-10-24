/**
 * After iTMSTransporter returns, ask App Store Connect until this build
 * number is listed. A green upload step is not enough: build 495 was marked
 * complete and never appeared.
 *
 * Env: APP_STORE_KEY_ID, APP_STORE_CONNECT_ISSUER_ID, BUILD_NUMBER, BUNDLE_ID
 * Key file: ~/.appstoreconnect/private_keys/AuthKey_<id>.p8
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const API = "https://api.appstoreconnect.apple.com";
const ATTEMPTS = 40;
const DELAY_MS = 30_000;

function b64url(value) {
  return Buffer.from(value).toString("base64url");
}

export function signAppStoreJwt(keyPem, keyId, issuerId, nowSec = Math.floor(Date.now() / 1000)) {
  const header = b64url(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      iss: issuerId,
      iat: nowSec,
      exp: nowSec + 19 * 60,
      aud: "appstoreconnect-v1",
    })
  );
  const data = `${header}.${payload}`;
  const signature = crypto.sign("sha256", Buffer.from(data), {
    key: crypto.createPrivateKey(keyPem),
    dsaEncoding: "ieee-p1363",
  });
  return `${data}.${b64url(signature)}`;
}

async function api(token, urlPath) {
  const response = await fetch(`${API}${urlPath}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`App Store Connect ${response.status} on ${urlPath}: ${text.slice(0, 280)}`);
  }
  return JSON.parse(text);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const keyId = process.env.APP_STORE_KEY_ID?.trim();
  const issuerId = process.env.APP_STORE_CONNECT_ISSUER_ID?.trim();
  const buildNumber = process.env.BUILD_NUMBER?.trim();
  const bundleId = process.env.BUNDLE_ID?.trim();
  if (!keyId || !issuerId || !buildNumber || !bundleId) {
    throw new Error("APP_STORE_KEY_ID, APP_STORE_CONNECT_ISSUER_ID, BUILD_NUMBER, and BUNDLE_ID are required.");
  }
  const keyPath = path.join(os.homedir(), ".appstoreconnect", "private_keys", `AuthKey_${keyId}.p8`);
  const keyPem = fs.readFileSync(keyPath, "utf8");

  const token = () => signAppStoreJwt(keyPem, keyId, issuerId);
  const apps = await api(
    token(),
    `/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&limit=1`
  );
  const appId = apps.data?.[0]?.id;
  if (!appId) {
    throw new Error(`No App Store Connect app for bundle id ${bundleId}.`);
  }

  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const listed = await api(
      token(),
      `/v1/builds?filter[app]=${encodeURIComponent(appId)}&filter[version]=${encodeURIComponent(buildNumber)}&limit=5`
    );
    const builds = listed.data ?? [];
    if (builds.length > 0) {
      const states = builds.map((build) => {
        const state = build.attributes?.processingState ?? "unknown";
        return `${build.id} ${state}`;
      });
      console.log(`Build ${buildNumber} is listed: ${states.join(", ")}`);
      const failed = builds.find((build) => {
        const state = build.attributes?.processingState;
        return state === "FAILED" || state === "INVALID";
      });
      if (failed) {
        throw new Error(
          `Apple listed build ${buildNumber} as ${failed.attributes?.processingState}. Check the Apple ID email for the rejection.`
        );
      }
      return;
    }
    console.log(
      `Build ${buildNumber} is not listed yet (${attempt}/${ATTEMPTS}). Waiting ${DELAY_MS / 1000}s.`
    );
    if (attempt < ATTEMPTS) await sleep(DELAY_MS);
  }
  throw new Error(
    `Apple never listed build ${buildNumber}. The upload tool can still exit 0. Check the Apple ID email.`
  );
}

if (process.argv.includes("--self-test")) {
  const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  const signed = signAppStoreJwt(pem, "KEYID", "ISSUER", 1_700_000_000);
  const parts = signed.split(".");
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    throw new Error("JWT self-test failed");
  }
  console.log("jwt self-test ok");
} else {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
