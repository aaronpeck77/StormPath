/**
 * Stormy brain. The Anthropic key stays in Netlify env as ANTHROPIC_API_KEY.
 * The app sends Authorization: Bearer STORMY_CLIENT_TOKEN. Without that match, this refuses.
 * Facts are the route's weather, traffic, and highway shields. She does not invent them.
 */
import {
  acceptStormyPacket,
  clampStormyReply,
  parseStormyModelText,
  STORMY_MODEL,
  stormySystemPrompt,
  type StormyPacket,
  type StormyReply,
} from "../../src/stormy/stormyFence.ts";

type NetlifyEvent = {
  httpMethod: string;
  headers?: Record<string, string | undefined>;
  body?: string | null;
};

type NetlifyResult = {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function header(event: NetlifyEvent, name: string): string | undefined {
  const headers = event.headers ?? {};
  const want = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === want) return value;
  }
  return undefined;
}

/** Same shared secret as VITE_STORMY_CLIENT_TOKEN baked into the TestFlight app. */
function clientAllowed(event: NetlifyEvent): boolean {
  const expected = process.env.STORMY_CLIENT_TOKEN?.trim();
  if (!expected) return false;
  const auth = header(event, "authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  return (match?.[1] ?? "").trim() === expected;
}

function json(statusCode: number, body: unknown): NetlifyResult {
  return {
    statusCode,
    headers: { ...CORS, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export async function completeStormy(
  packet: StormyPacket,
  apiKey: string,
  fetchImpl: typeof fetch = fetch
): Promise<StormyReply> {
  const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: STORMY_MODEL,
      max_tokens: 180,
      system: stormySystemPrompt(),
      messages: [{ role: "user", content: JSON.stringify(packet) }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic ${response.status}`);
  }

  const data = (await response.json()) as {
    content?: { type?: string; text?: string }[];
  };
  const text = data.content?.find((block) => block.type === "text")?.text ?? "";
  return clampStormyReply(parseStormyModelText(text), packet);
}

export const handler = async (event: NetlifyEvent): Promise<NetlifyResult> => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }
  if (!clientAllowed(event)) {
    return json(401, { error: "Stormy could not answer." });
  }

  let raw: unknown;
  try {
    raw = JSON.parse(event.body || "");
  } catch {
    return json(400, { error: "Stormy needs a trip packet." });
  }

  const accepted = acceptStormyPacket(raw);
  if (!accepted.ok) return json(400, { error: accepted.error });

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return json(503, { error: "Stormy is not configured." });
  }

  try {
    const reply = await completeStormy(accepted.packet, apiKey);
    return json(200, reply);
  } catch {
    return json(502, { error: "Stormy could not answer." });
  }
};
