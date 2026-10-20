/**
 * The phone asks this. The xAI key stays in Netlify as XAI_API_KEY.
 * The reply is saved on the dock so the phone can show it and speak it.
 */
import { connectBlobsIfLambda } from "./_blobsLambda.ts";
import { makeDockTrip } from "./grok-dock.ts";
import {
  dockRpcPlainText,
  handleDockRpc,
  prepareAssistantForward,
  saveAssistantReply,
  type DockSession,
  type DockStore,
} from "../../src/grok/grokDock.ts";
import {
  functionCallsFromXai,
  replyTextFromXai,
  xaiFollowUpBody,
  xaiRequestBody,
  xaiResponseId,
} from "../../src/grok/xaiReply.ts";

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

function mapboxToken(): string {
  return (process.env.MAPBOX_SECRET_TOKEN || process.env.VITE_MAPBOX_TOKEN || process.env.MAPBOX_TOKEN || "").trim();
}

async function postXai(key: string, body: unknown): Promise<unknown> {
  const res = await fetch("https://api.x.ai/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const raw = await res.text();
    console.error("[grok-assistant] xAI status", res.status, raw.slice(0, 300));
    const badKey = res.status === 400 && /api key/i.test(raw);
    throw new Error(badKey ? "bad-key" : "xai");
  }
  return res.json();
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
  let ready = await prepareAssistantForward(store, parsed);
  for (let attempt = 0; !ready.ok && ready.status === 404 && attempt < 4; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    ready = await prepareAssistantForward(store, parsed);
  }
  if (!ready.ok) return json(ready.status, { ok: false, error: ready.error });

  const key = process.env.XAI_API_KEY?.trim();
  if (!key) {
    console.error("[grok-assistant] XAI_API_KEY is missing");
    return json(503, { ok: false, error: "The assistant is not configured yet." });
  }
  try {
    let data = await postXai(key, xaiRequestBody(ready.payload.text));
    const trip = makeDockTrip(mapboxToken());
    let usedTool = false;
    for (let round = 0; round < 2; round++) {
      const calls = functionCallsFromXai(data);
      const previousId = xaiResponseId(data);
      if (!calls.length || !previousId) break;
      usedTool = true;
      const outputs: { callId: string; output: string }[] = [];
      for (const call of calls) {
        const rpc = await handleDockRpc(
          {
            method: "tools/call",
            id: call.callId,
            params: {
              name: call.name,
              arguments: { ...call.arguments, dock_code: ready.payload.dock_code },
            },
          },
          store,
          trip
        );
        outputs.push({ callId: call.callId, output: dockRpcPlainText(rpc) || "Done." });
      }
      try {
        data = await postXai(key, xaiFollowUpBody(previousId, outputs));
      } catch (e) {
        console.error("[grok-assistant] tool follow-up failed", e instanceof Error ? e.message : "error");
        await saveAssistantReply(
          store,
          ready.payload.dock_code,
          "I sent that to StormPath. It is measuring the trip again from where you are."
        );
        return json(200, { ok: true });
      }
    }
    const reply =
      replyTextFromXai(data) ||
      (usedTool ? "I sent that to StormPath. It is measuring the trip again from where you are." : "");
    if (!reply) {
      console.error("[grok-assistant] xAI returned no spoken line");
      return json(502, { ok: false, error: "The assistant did not accept that." });
    }
    await saveAssistantReply(store, ready.payload.dock_code, reply);
  } catch (e) {
    const detail = e instanceof Error ? e.message : "error";
    console.error("[grok-assistant] xAI failed", detail);
    if (detail === "bad-key") {
      return json(502, { ok: false, error: "Grok refused the key saved on stormpath2." });
    }
    return json(502, { ok: false, error: "The assistant did not accept that." });
  }
  return json(200, { ok: true });
};
