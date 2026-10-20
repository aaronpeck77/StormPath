/**
 * Grok dock. The phone shows a short code. Grok calls this server with that code.
 * StormPath measures the trip. Grok may only say those facts.
 * start_drive and stop_drive run only when the driver asked.
 */

export const GROK_DOCK_URL = "https://stormpath2.netlify.app/.netlify/functions/grok-dock";
export const GROK_DOCK_CODE_KEY = "stormpath-grok-dock-code";
export const GROK_DOCK_APPLIED_KEY = "stormpath-grok-dock-applied";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export type LngLat = [number, number];

export type DockOrigin = { lng: number; lat: number; at: string };

export type DockPlan = {
  id: string;
  destinationLabel: string;
  destination: LngLat;
  stopLabel: string | null;
  stop: LngLat | null;
  minutes: number;
  miles: number;
  trafficNote: string;
  weatherNote: string;
  summary: string;
};

export type DockMessage = {
  id: string;
  text: string;
  at: string;
};

export type DockControl = {
  id: string;
  action: "start" | "stop";
};

export type DockSession = {
  code: string;
  origin: DockOrigin | null;
  plan: DockPlan | null;
  messages?: DockMessage[];
  /** One start or stop the phone has not run yet. */
  control?: DockControl | null;
  /** Recent tool and talk times, used only to slow a noisy code. */
  rateHits?: number[];
};

export type DockStore = {
  get(code: string): Promise<DockSession | null>;
  put(session: DockSession): Promise<void>;
};

export type GeocodedPlace = { label: string; lng: number; lat: number };

export type MeasuredLeg = {
  minutes: number;
  miles: number;
  trafficNote: string;
  weatherNote: string;
};

export type DockTripService = {
  geocode(query: string, near: DockOrigin | null): Promise<GeocodedPlace | null>;
  measure(origin: DockOrigin, destination: LngLat, stop: LngLat | null): Promise<MeasuredLeg>;
};

export function newDockCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

export function dockCodeOk(code: string): boolean {
  return /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(code.trim().toUpperCase());
}

export function normalizeDockCode(code: string): string {
  return code.trim().toUpperCase();
}

export function trafficNoteFromDurations(trafficMinutes: number, typicalMinutes: number | null, heavySegments: number): string {
  if (typicalMinutes != null && trafficMinutes > typicalMinutes + 8) {
    const extra = Math.round(trafficMinutes - typicalMinutes);
    return `Traffic adds about ${extra} minutes.`;
  }
  if (heavySegments > 0) return "Some slow segments are on this route.";
  return "No heavy slowdown measured on this route.";
}

export function weatherNoteFromEvents(events: string[]): string {
  const unique = [...new Set(events.map((e) => e.trim()).filter(Boolean))].slice(0, 4);
  if (unique.length === 0) return "No weather warnings at the points StormPath checked.";
  return `Weather warnings: ${unique.join("; ")}.`;
}

export function formatTripLength(minutes: number): string {
  const rounded = Math.max(1, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;
  if (hours <= 0) return `${mins} minutes`;
  if (mins === 0) return `${hours} hours`;
  return `${hours} hours ${mins} minutes`;
}

export function speakablePlan(plan: DockPlan): string {
  const stop = plan.stopLabel ? ` Lunch stop: ${plan.stopLabel}.` : "";
  return [
    "StormPath measured this trip. Say only these facts.",
    `Destination: ${plan.destinationLabel}.`,
    `About ${formatTripLength(plan.minutes)}, ${plan.miles} miles.`,
    plan.trafficNote,
    plan.weatherNote + stop,
    "The route is on the phone. If the driver asked you to leave, call start_drive. Otherwise ask them to hit Go before they leave. Call stop_drive when they ask to stop.",
    "Do not add a storm, a game, a place, or a time that is not written here.",
  ].join(" ");
}

type JsonRpc = {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: { name?: string; arguments?: Record<string, unknown> };
};

export type DockHttpResult = {
  status: number;
  body: string;
  contentType: string;
};

function rpcResult(id: number | string | null | undefined, result: unknown): DockHttpResult {
  return {
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ jsonrpc: "2.0", id: id ?? null, result }),
  };
}

function rpcError(id: number | string | null | undefined, message: string): DockHttpResult {
  return {
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ jsonrpc: "2.0", id: id ?? null, error: { code: -32000, message } }),
  };
}

const TOOLS = [
  {
    name: "plan_route",
    description:
      "Ask StormPath to measure a driving route for this phone and place it on the map. Use only the facts in the result. Call start_drive only when the driver asked to leave.",
    inputSchema: {
      type: "object",
      properties: {
        dock_code: { type: "string", description: "Six-character code shown in StormPath under Your assistant." },
        destination: { type: "string", description: "Where the driver wants to go." },
        stop: { type: "string", description: "Optional lunch or errand stop before the destination." },
      },
      required: ["dock_code", "destination"],
    },
  },
  {
    name: "add_stop",
    description: "Add one stop to the trip StormPath already measured, then measure it again.",
    inputSchema: {
      type: "object",
      properties: {
        dock_code: { type: "string" },
        place: { type: "string", description: "The stop to add, such as a city or a restaurant." },
      },
      required: ["dock_code", "place"],
    },
  },
  {
    name: "read_trip",
    description: "Read the trip StormPath last measured for this phone.",
    inputSchema: {
      type: "object",
      properties: { dock_code: { type: "string" } },
      required: ["dock_code"],
    },
  },
  {
    name: "start_drive",
    description: "Start the measured route. Call this only when the driver asked to leave.",
    inputSchema: {
      type: "object",
      properties: { dock_code: { type: "string" } },
      required: ["dock_code"],
    },
  },
  {
    name: "stop_drive",
    description: "Stop the route. Call this only when the driver asked to stop.",
    inputSchema: {
      type: "object",
      properties: { dock_code: { type: "string" } },
      required: ["dock_code"],
    },
  },
  {
    name: "say_to_driver",
    description: "Show a short reply in StormPath and have the phone speak it. Keep it to a sentence or two.",
    inputSchema: {
      type: "object",
      properties: {
        dock_code: { type: "string" },
        message: { type: "string", description: "What the driver should hear. Short." },
      },
      required: ["dock_code", "message"],
    },
  },
];

async function requireSession(store: DockStore, rawCode: unknown): Promise<DockSession | DockHttpResult> {
  const code = normalizeDockCode(String(rawCode ?? ""));
  if (!dockCodeOk(code)) {
    return rpcError(null, "StormPath needs the six-character code from the phone.");
  }
  const session = await store.get(code);
  if (!session) {
    return rpcError(null, "That code is not connected. Open StormPath, Info, Your assistant, and read the code.");
  }
  return session;
}

function asError(value: DockSession | DockHttpResult): value is DockHttpResult {
  return "status" in value;
}

const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 20;

export function originReady(origin: DockOrigin | null | undefined): origin is DockOrigin {
  if (!origin) return false;
  return Number.isFinite(origin.lng) && Number.isFinite(origin.lat) && Math.abs(origin.lat) <= 90 && Math.abs(origin.lng) <= 180;
}

export const LOCATION_NEEDED = "StormPath does not have this phone's location yet. Open the app and allow location.";

/** True when this code is still under the per-minute cap. Caller must save the session. */
export function takeRateSlot(session: DockSession, now = Date.now()): boolean {
  const hits = (session.rateHits ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_LIMIT) {
    session.rateHits = hits;
    return false;
  }
  hits.push(now);
  session.rateHits = hits;
  return true;
}

export async function saveAssistantReply(store: DockStore, code: string, text: string): Promise<void> {
  const session = await store.get(code);
  if (!session) return;
  rememberDriverMessage(session, text);
  await store.put(session);
}

export function rememberDriverMessage(session: DockSession, text: string): DockMessage {
  const message: DockMessage = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    text: text.replace(/\s+/g, " ").trim().slice(0, 4000),
    at: new Date().toISOString(),
  };
  const prev = session.messages ?? [];
  session.messages = [...prev, message].slice(-20);
  return message;
}

export async function planRoute(
  store: DockStore,
  trip: DockTripService,
  session: DockSession,
  destinationQuery: string,
  stopQuery: string | null
): Promise<DockPlan> {
  if (!originReady(session.origin)) {
    throw new Error(LOCATION_NEEDED);
  }
  const destination = await trip.geocode(destinationQuery, session.origin);
  if (!destination) throw new Error(`StormPath could not find ${destinationQuery}.`);
  let stop: GeocodedPlace | null = null;
  if (stopQuery?.trim()) {
    stop = await trip.geocode(stopQuery, session.origin);
    if (!stop) throw new Error(`StormPath could not find the stop ${stopQuery}.`);
  }
  const measured = await trip.measure(session.origin, [destination.lng, destination.lat], stop ? [stop.lng, stop.lat] : null);
  const plan: DockPlan = {
    id: `${Date.now().toString(36)}-${destination.label.slice(0, 24)}`,
    destinationLabel: destination.label,
    destination: [destination.lng, destination.lat],
    stopLabel: stop?.label ?? null,
    stop: stop ? [stop.lng, stop.lat] : null,
    minutes: measured.minutes,
    miles: measured.miles,
    trafficNote: measured.trafficNote,
    weatherNote: measured.weatherNote,
    summary: "",
  };
  plan.summary = speakablePlan(plan);
  session.plan = plan;
  await store.put(session);
  return plan;
}

export async function handleDockRpc(
  message: JsonRpc,
  store: DockStore,
  trip: DockTripService
): Promise<DockHttpResult | null> {
  const method = message.method ?? "";
  if (method === "notifications/initialized" || method.startsWith("notifications/")) return null;
  if (method === "initialize") {
    return rpcResult(message.id, {
      protocolVersion: "2025-03-26",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "stormpath", version: "1" },
    });
  }
  if (method === "tools/list") return rpcResult(message.id, { tools: TOOLS });
  if (method !== "tools/call") return rpcError(message.id, `Unknown method ${method}`);

  const name = message.params?.name ?? "";
  const args = message.params?.arguments ?? {};
  const found = await requireSession(store, args.dock_code);
  if (asError(found)) return { ...found, body: rewriteRpcId(found.body, message.id) };
  if (!takeRateSlot(found)) {
    await store.put(found);
    return rpcError(message.id, "StormPath is getting too many requests for this code. Wait a minute.");
  }
  await store.put(found);

  try {
    if (name === "read_trip") {
      if (!found.plan) {
        return rpcResult(message.id, { content: [{ type: "text", text: "StormPath has no trip for this phone yet." }] });
      }
      return rpcResult(message.id, { content: [{ type: "text", text: found.plan.summary }] });
    }
    if (name === "plan_route") {
      const destination = String(args.destination ?? "").trim();
      if (!destination) return rpcError(message.id, "Say where the driver is going.");
      const stop = typeof args.stop === "string" ? args.stop : null;
      const plan = await planRoute(store, trip, found, destination, stop);
      return rpcResult(message.id, { content: [{ type: "text", text: plan.summary }] });
    }
    if (name === "start_drive") {
      if (!found.plan) return rpcError(message.id, "Set a destination before starting the drive.");
      found.control = { id: `${Date.now().toString(36)}-start`, action: "start" };
      await store.put(found);
      return rpcResult(message.id, { content: [{ type: "text", text: "StormPath will start the drive." }] });
    }
    if (name === "stop_drive") {
      found.control = { id: `${Date.now().toString(36)}-stop`, action: "stop" };
      await store.put(found);
      return rpcResult(message.id, { content: [{ type: "text", text: "StormPath will stop the route." }] });
    }
    if (name === "say_to_driver") {
      const text = String(args.message ?? "").trim();
      if (!text) return rpcError(message.id, "Say what the driver should hear.");
      const saved = rememberDriverMessage(found, text);
      await store.put(found);
      return rpcResult(message.id, {
        content: [{ type: "text", text: `StormPath will show and speak: ${saved.text}` }],
      });
    }
    if (name === "add_stop") {
      if (!found.plan) return rpcError(message.id, "Plan a destination before adding a stop.");
      const place = String(args.place ?? "").trim();
      if (!place) return rpcError(message.id, "Say which stop to add.");
      const plan = await planRoute(store, trip, found, found.plan.destinationLabel, place);
      return rpcResult(message.id, { content: [{ type: "text", text: plan.summary }] });
    }
    return rpcError(message.id, `Unknown tool ${name}`);
  } catch (e) {
    const messageText = e instanceof Error ? e.message : "StormPath could not measure that trip.";
    return rpcError(message.id, messageText);
  }
}

function rewriteRpcId(body: string, id: number | string | null | undefined): string {
  try {
    const parsed = JSON.parse(body) as { id?: unknown };
    parsed.id = id ?? null;
    return JSON.stringify(parsed);
  } catch {
    return body;
  }
}

export async function handlePhoneClaim(store: DockStore, rawCode: unknown): Promise<DockHttpResult> {
  const code = normalizeDockCode(String(rawCode ?? ""));
  if (!dockCodeOk(code)) {
    return { status: 400, contentType: "application/json", body: JSON.stringify({ ok: false, error: "bad code" }) };
  }
  const existing = await store.get(code);
  if (!existing) await store.put({ code, origin: null, plan: null });
  return { status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, code }) };
}

export async function handlePhoneOrigin(
  store: DockStore,
  rawCode: unknown,
  lng: unknown,
  lat: unknown
): Promise<DockHttpResult> {
  const code = normalizeDockCode(String(rawCode ?? ""));
  const session = await store.get(code);
  if (!session) {
    return { status: 404, contentType: "application/json", body: JSON.stringify({ ok: false, error: "not connected" }) };
  }
  const lngN = Number(lng);
  const latN = Number(lat);
  if (!Number.isFinite(lngN) || !Number.isFinite(latN)) {
    return { status: 400, contentType: "application/json", body: JSON.stringify({ ok: false, error: "location" }) };
  }
  session.origin = { lng: lngN, lat: latN, at: new Date().toISOString() };
  await store.put(session);
  return { status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) };
}

export type AssistantForward = {
  dock_code: string;
  text: string;
  location?: { lat: number; lng: number };
  sent_at: string;
};

/** Check the code and build the body the server will post. Does not know the webhook. */
export async function prepareAssistantForward(
  store: DockStore,
  raw: { dock_code?: unknown; text?: unknown; location?: { lat?: unknown; lng?: unknown } | null }
): Promise<{ ok: true; payload: AssistantForward } | { ok: false; status: number; error: string }> {
  const code = normalizeDockCode(String(raw.dock_code ?? ""));
  if (!dockCodeOk(code)) return { ok: false, status: 400, error: "That code is not valid." };
  const session = await store.get(code);
  if (!session) return { ok: false, status: 404, error: "That code is not connected. Open Info and connect again." };
  const text = String(raw.text ?? "").replace(/\s+/g, " ").trim();
  if (!text) return { ok: false, status: 400, error: "Say something first." };
  if (text.length > 900) return { ok: false, status: 400, error: "That is too long. Keep it to a sentence or two." };
  if (!takeRateSlot(session)) {
    await store.put(session);
    return { ok: false, status: 429, error: "Wait a minute before sending more." };
  }
  await store.put(session);
  const loc = raw.location;
  const lat = Number(loc?.lat);
  const lng = Number(loc?.lng);
  const location = Number.isFinite(lat) && Number.isFinite(lng)
    ? { lat, lng }
    : originReady(session.origin)
      ? { lat: session.origin.lat, lng: session.origin.lng }
      : undefined;
  return {
    ok: true,
    payload: {
      dock_code: code,
      text: text.slice(0, 900),
      ...(location ? { location } : {}),
      sent_at: new Date().toISOString(),
    },
  };
}

export async function handlePhoneRead(store: DockStore, rawCode: unknown): Promise<DockHttpResult> {
  const code = normalizeDockCode(String(rawCode ?? ""));
  const session = await store.get(code);
  if (!session) {
    return { status: 404, contentType: "application/json", body: JSON.stringify({ ok: false, plan: null }) };
  }
  return {
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      plan: session.plan,
      messages: session.messages ?? [],
      control: session.control ?? null,
    }),
  };
}
