/**
 * The phone asks this. The xAI key stays in Netlify as XAI_API_KEY.
 * The reply is saved on the dock so the phone can show it and speak it.
 */
import { connectBlobsIfLambda } from "./_blobsLambda.ts";
import { prepareAssistantForward, saveAssistantReply, type DockSession, type DockStore } from "../../src/grok/grokDock.ts";
import { replyTextFromXai, xaiRequestBody } from "../../src/grok/xaiReply.ts";

type NetlifyEvent = {
  httpMethod?: string;
  headers?: Record<string, string | undefined>;
  body?: string | null;
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const memory = new Map<string, DockSession>();

async function blobStore(event: unknown): Promise<DockStore> {
  await connectBlobsIfLambda(event);
  return {
    async get(code) {
      try {
        const { getStore } = await import("@netlify/blobs");
        const store = getStore("stormpath-grok-dock");
        const data = await store.get(code, { type: "json" });
        if (data && typeof data === "object" && (data as DockSession).code) return data as DockSession;
      } catch (e) {
        console.error("[grok-assistant] blob read failed", e);
      }
      return memory.get(code) ?? null;
    },
    async put(session) {
      memory.set(session.code, session);
      try {
        const { getStore } = await import("@netlify/blobs");
        const store = getStore("stormpath-grok-dock");
        await store.setJSON(session.code, session);
      } catch (e) {
        console.error("[grok-assistant] blob write failed", e);
      }
    },
  };
}

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { ...CORS, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export const handler = async (event: NetlifyEvent) => {
  if ((event.httpMethod ?? "POST").toUpperCase() === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }
  if ((event.httpMethod ?? "").toUpperCase() !== "POST") {
    return json(405, { ok: false, error: "Send a message with POST." });
  }
  let parsed: { dock_code?: unknown; text?: unknown; location?: { lat?: unknown; lng?: unknown } } = {};
  try {
    parsed = event.body ? (JSON.parse(event.body) as typeof parsed) : {};
  } catch {
    return json(400, { ok: false, error: "That message was not readable." });
  }
  const store = await blobStore(event);
  const ready = await prepareAssistantForward(store, parsed);
  if (!ready.ok) return json(ready.status, { ok: false, error: ready.error });

  const key = process.env.XAI_API_KEY?.trim();
  if (!key) {
    console.error("[grok-assistant] XAI_API_KEY is missing");
    return json(503, { ok: false, error: "The assistant is not configured yet." });
  }
  try {
    const res = await fetch("https://api.x.ai/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(xaiRequestBody(ready.payload.text)),
    });
    if (!res.ok) {
      console.error("[grok-assistant] xAI status", res.status);
      return json(502, { ok: false, error: "The assistant did not accept that." });
    }
    const reply = replyTextFromXai(await res.json());
    if (!reply) {
      console.error("[grok-assistant] xAI returned no spoken line");
      return json(502, { ok: false, error: "The assistant did not accept that." });
    }
    await saveAssistantReply(store, ready.payload.dock_code, reply);
  } catch (e) {
    console.error("[grok-assistant] xAI failed", e instanceof Error ? e.message : "error");
    return json(502, { ok: false, error: "The assistant did not accept that." });
  }
  return json(200, { ok: true });
};
