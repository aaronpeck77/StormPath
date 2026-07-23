/**
 * "Jeff the Fix-It Bot" activity log ingest + read for StormPath Control Room.
 *
 * POST (Bearer OPS_USAGE_INGEST_TOKEN or OPS_HUB_SECRET): append fix events from a device.
 * GET  (Bearer OPS_HUB_SECRET): recent fixes + today/7-day/month rollups.
 */

import { appendJeffFixEvents, buildJeffFixSummary } from "./_jeffFixLogStore.ts";
import { connectBlobsIfLambda } from "./_blobsLambda.ts";

type NetlifyEvent = {
  httpMethod: string;
  headers?: Record<string, string | undefined>;
  body?: string | null;
  isBase64Encoded?: boolean;
  queryStringParameters?: Record<string, string | undefined> | null;
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json",
  "Cache-Control": "private, max-age=30",
};

function header(event: NetlifyEvent, name: string): string | undefined {
  const h = event.headers ?? {};
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(h)) {
    if (k.toLowerCase() === want) return v;
  }
  return undefined;
}

function bearer(event: NetlifyEvent): string {
  const auth = header(event, "authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  return (m?.[1] ?? event.queryStringParameters?.key ?? "").trim();
}

function canIngest(token: string): boolean {
  const ingest = process.env.OPS_USAGE_INGEST_TOKEN?.trim();
  const hub = process.env.OPS_HUB_SECRET?.trim();
  if (!token) return false;
  if (ingest && token === ingest) return true;
  if (hub && token === hub) return true;
  return false;
}

function canRead(token: string): boolean {
  const hub = process.env.OPS_HUB_SECRET?.trim();
  return Boolean(hub && token === hub);
}

function parseBody(event: NetlifyEvent): unknown {
  if (!event.body) return null;
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export const handler = async (event: NetlifyEvent) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  await connectBlobsIfLambda(event);
  const token = bearer(event);

  if (event.httpMethod === "GET") {
    if (!canRead(token)) {
      return {
        statusCode: 401,
        headers: CORS,
        body: JSON.stringify({ error: "Unauthorized" }),
      };
    }
    const summary = await buildJeffFixSummary();
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify(summary),
    };
  }

  if (event.httpMethod === "POST") {
    if (!canIngest(token)) {
      return {
        statusCode: 401,
        headers: CORS,
        body: JSON.stringify({
          error:
            "Unauthorized — set OPS_USAGE_INGEST_TOKEN (and VITE_OPS_USAGE_INGEST_TOKEN in the app build)",
        }),
      };
    }
    const body = parseBody(event) as { events?: unknown[]; deviceId?: string } | null;
    if (!body || !Array.isArray(body.events)) {
      return {
        statusCode: 400,
        headers: CORS,
        body: JSON.stringify({ error: "Expected JSON body with an events array" }),
      };
    }
    const result = await appendJeffFixEvents(body.events);
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ ok: true, ...result }),
    };
  }

  return {
    statusCode: 405,
    headers: CORS,
    body: JSON.stringify({ error: "Method not allowed" }),
  };
};
