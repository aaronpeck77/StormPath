/**
 * Signs short-lived WeatherKit REST JWTs. Private key lives in Netlify env only.
 *
 * Required env vars (Site configuration → Environment variables):
 *   WEATHERKIT_TEAM_ID       — Apple Team ID (e.g. 8Y86R5V45T)
 *   WEATHERKIT_KEY_ID        — Key ID from the .p8 download page
 *   WEATHERKIT_SERVICE_ID    — Services ID (e.g. com.aaronpeck.stormpath.weatherkit)
 *   WEATHERKIT_PRIVATE_KEY   — Full .p8 PEM; paste with literal \n for newlines
 */
import crypto from "node:crypto";

type NetlifyHandler = (
  event: { httpMethod: string }
) => Promise<{ statusCode: number; headers?: Record<string, string>; body: string }>;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

let cached: { token: string; expiresAtMs: number } | null = null;

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

function normalizePrivateKeyPem(raw: string): string | null {
  let key = raw.trim();
  if (!key) return null;
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1).trim();
  }
  key = key.replace(/\\n/g, "\n").replace(/\r\n/g, "\n");
  if (!key.includes("BEGIN")) {
    key = `-----BEGIN PRIVATE KEY-----\n${key}\n-----END PRIVATE KEY-----`;
  }
  return key;
}

function readPrivateKey(): crypto.KeyObject | null {
  const raw = process.env.WEATHERKIT_PRIVATE_KEY?.trim();
  if (!raw) return null;
  const pem = normalizePrivateKeyPem(raw);
  if (!pem) return null;
  try {
    return crypto.createPrivateKey({ key: pem, format: "pem" });
  } catch {
    return null;
  }
}

function signWeatherKitJwt(): { token: string; expiresAtMs: number } {
  const teamId = process.env.WEATHERKIT_TEAM_ID?.trim();
  const keyId = process.env.WEATHERKIT_KEY_ID?.trim();
  const serviceId = process.env.WEATHERKIT_SERVICE_ID?.trim();
  const privateKey = readPrivateKey();
  if (!teamId || !keyId || !serviceId || !privateKey) {
    throw new Error("WeatherKit env incomplete");
  }

  const now = Math.floor(Date.now() / 1000);
  const exp = now + 3600;
  const header = {
    alg: "ES256",
    kid: keyId,
    id: `${teamId}.${serviceId}`,
  };
  const payload = {
    iss: teamId,
    iat: now,
    exp,
    sub: serviceId,
  };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const signature = crypto
    .sign("sha256", Buffer.from(signingInput), {
      key: privateKey,
      dsaEncoding: "ieee-p1363",
    })
    .toString("base64url");

  return {
    token: `${signingInput}.${signature}`,
    expiresAtMs: exp * 1000,
  };
}

export const handler: NetlifyHandler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers: CORS, body: "Method not allowed" };
  }

  try {
    if (cached && cached.expiresAtMs > Date.now() + 120_000) {
      return {
        statusCode: 200,
        headers: {
          ...CORS,
          "Content-Type": "application/json",
          "Cache-Control": "private, max-age=3000",
        },
        body: JSON.stringify(cached),
      };
    }

    const signed = signWeatherKitJwt();
    cached = signed;
    return {
      statusCode: 200,
      headers: {
        ...CORS,
        "Content-Type": "application/json",
        "Cache-Control": "private, max-age=3000",
      },
      body: JSON.stringify(signed),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    const pemPresent = Boolean(process.env.WEATHERKIT_PRIVATE_KEY?.trim());
    const keyParses = Boolean(readPrivateKey());
    const configured = {
      teamId: Boolean(process.env.WEATHERKIT_TEAM_ID?.trim()),
      keyId: Boolean(process.env.WEATHERKIT_KEY_ID?.trim()),
      serviceId: Boolean(process.env.WEATHERKIT_SERVICE_ID?.trim()),
      privateKey: pemPresent,
      privateKeyParses: keyParses,
    };
    return {
      statusCode: 503,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "WeatherKit token signing not configured",
        hint:
          msg === "WeatherKit env incomplete"
            ? keyParses
              ? "Env vars present but signing failed — verify KEY_ID matches the .p8 file."
              : pemPresent
                ? "Private key present but PEM parse failed. Use one line: -----BEGIN PRIVATE KEY-----\\nMIGT...\\n-----END PRIVATE KEY-----"
                : "One or more WEATHERKIT_* env vars are missing for Functions scope."
            : `JWT signing failed: ${msg}`,
        configured,
      }),
    };
  }
};
