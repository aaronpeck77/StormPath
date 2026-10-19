/**
 * Grok dock. The phone shows a short code. Grok calls this server with that code.
 * StormPath measures the trip. Grok may only say those facts. The driver still hits Go.
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

export type DockSession = {
  code: string;
  origin: DockOrigin | null;
  plan: DockPlan | null;
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
    "The route is on the phone. Ask the driver to hit Go before they leave.",
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
      "Ask StormPath to measure a driving route for this phone and place it on the map. The driver still hits Go. Use only the facts in the result.",
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

export async function planRoute(
  store: DockStore,
  trip: DockTripService,
  session: DockSession,
  destinationQuery: string,
  stopQuery: string | null
): Promise<DockPlan> {
  if (!session.origin) {
    throw new Error("StormPath does not have this phone's location yet. Open the app and allow location.");
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

export async function handlePhoneRead(store: DockStore, rawCode: unknown): Promise<DockHttpResult> {
  const code = normalizeDockCode(String(rawCode ?? ""));
  const session = await store.get(code);
  if (!session) {
    return { status: 404, contentType: "application/json", body: JSON.stringify({ ok: false, plan: null }) };
  }
  return {
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, plan: session.plan }),
  };
}
