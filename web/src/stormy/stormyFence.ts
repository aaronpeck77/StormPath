/**
 * Stormy speaks from a small trip packet and a fixed action list.
 * She can work StormPath: set a place, start the drive, switch a listed route,
 * toggle radar, recenter, or end the trip. She stays quiet through a turn.
 */

export const STORMY_MODEL = "claude-haiku-5-5";

export const STORMY_ACTIONS = [
  "none",
  "quiet",
  "explain_ahead",
  "go_to",
  "start_drive",
  "use_route",
  "radar_on",
  "radar_off",
  "end_trip",
  "recenter",
] as const;

export type StormyAction = (typeof STORMY_ACTIONS)[number];

export const STORMY_MAX_PACKET_CHARS = 6_000;
export const STORMY_MAX_SAY_CHARS = 420;
export const STORMY_MAX_HAZARDS = 6;
export const STORMY_MAX_ROUTES = 3;
export const STORMY_MAX_LINE = 240;
export const STORMY_MAX_WEATHER = 4;
export const STORMY_MAX_TRAFFIC = 4;
export const STORMY_MAX_ROADS = 8;

export type StormyRouteChoice = {
  id: string;
  label: string;
  summary: string;
};

export type StormyPacket = {
  aheadLine: string;
  hazards: string[];
  routes: StormyRouteChoice[];
  driving: boolean;
  turnImminent: boolean;
  /** What the driver just said. Empty when she is only reading the trip. */
  question: string;
  /** Weather already computed on this route. */
  weather: string[];
  /** Slowdowns, wrecks, and closures already computed on this route. */
  traffic: string[];
  /** Highway shields on the route she is reading, such as I-75. */
  roads: string[];
  /** Weather where the driver is right now. Empty when it has not loaded. */
  forecast: string;
  /** Where the route is headed. Empty before a destination is set. */
  destination: string;
  /** Spoken time left, such as "42 minutes". Empty when unknown. */
  eta: string;
  /** Spoken distance left. Empty when unknown. */
  milesLeft: string;
  /** Stops already on the route. */
  stops: string[];
  /** City and state where the driver is, such as "Decatur, Illinois". Empty when unknown. */
  here: string;
};

export type StormyReply = {
  say: string;
  action: StormyAction;
  needsYes: boolean;
  /** Place name for go_to. Empty for every other action. */
  place: string;
  /** Route id from the packet for use_route. Empty otherwise. */
  routeId: string;
  /** go_to also starts the drive when she was told to leave, not only to plan. */
  drive: boolean;
  /** Add the place as a stop on the current route instead of replacing the destination. */
  stop: boolean;
  /** Final destination when place is a stop they named first. Empty for a single place. */
  thenPlace: string;
  /** place: she asked where. choice: she asked which nearby place. Empty means she is not waiting. */
  clarify: "" | "place" | "choice";
};

/** What the app did. A clarify result means she asked something and should listen once more. */
export type StormyActResult = string | void | { say: string; clarify: "place" | "choice" };

export type StormyFenceResult =
  | { ok: true; packet: StormyPacket }
  | { ok: false; error: string };

const QUIET_REPLY: StormyReply = { say: "", action: "quiet", needsYes: false, place: "", routeId: "", drive: false, stop: false, thenPlace: "", clarify: "" };
const SILENT_REPLY: StormyReply = { say: "", action: "none", needsYes: false, place: "", routeId: "", drive: false, stop: false, thenPlace: "", clarify: "" };

function clip(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function clipLines(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((line) => clip(line, STORMY_MAX_LINE)).filter(Boolean).slice(0, max);
}

function isAction(value: unknown): value is StormyAction {
  return typeof value === "string" && (STORMY_ACTIONS as readonly string[]).includes(value);
}

export function acceptStormyPacket(raw: unknown): StormyFenceResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "Stormy needs a trip packet." };
  }
  const body = raw as Record<string, unknown>;
  const hazardsIn = Array.isArray(body.hazards) ? body.hazards : [];
  const routesIn = Array.isArray(body.routes) ? body.routes : [];
  if (hazardsIn.length > STORMY_MAX_HAZARDS || routesIn.length > STORMY_MAX_ROUTES) {
    return { ok: false, error: "That trip packet is too big." };
  }

  const routes: StormyRouteChoice[] = [];
  for (const item of routesIn) {
    if (!item || typeof item !== "object") continue;
    const route = item as Record<string, unknown>;
    const id = clip(route.id, 40);
    const label = clip(route.label, 40);
    const summary = clip(route.summary, STORMY_MAX_LINE);
    if (!id || !label) continue;
    routes.push({ id, label, summary });
  }

  const packet: StormyPacket = {
    aheadLine: clip(body.aheadLine, STORMY_MAX_LINE),
    hazards: hazardsIn.map((line) => clip(line, STORMY_MAX_LINE)).filter(Boolean),
    routes,
    driving: body.driving === true,
    turnImminent: body.turnImminent === true,
    question: clip(body.question, STORMY_MAX_LINE),
    weather: clipLines(body.weather, STORMY_MAX_WEATHER),
    traffic: clipLines(body.traffic, STORMY_MAX_TRAFFIC),
    roads: clipLines(body.roads, STORMY_MAX_ROADS).map((road) => road.slice(0, 24)),
    forecast: clip(body.forecast, STORMY_MAX_LINE),
    destination: clip(body.destination, STORMY_MAX_LINE),
    eta: clip(body.eta, 40),
    milesLeft: clip(body.milesLeft, 40),
    stops: clipLines(body.stops, 3),
    here: clip(body.here, 80),
  };

  if (JSON.stringify(packet).length > STORMY_MAX_PACKET_CHARS) {
    return { ok: false, error: "That trip packet is too big." };
  }
  return { ok: true, packet };
}

export function stormySystemPrompt(): string {
  return [
    "You are Stormy, a person in the passenger seat. Talk like you are on the trip with them.",
    "Two or three spoken sentences is fine when the trip has detail. Use destination, eta, milesLeft, stops, weather, traffic, forecast, and roads.",
    "One place per request. Food, coffee, and gas become a stop only when a destination is already set.",
    "Never say you are an AI. Never say the word packet. Never invent a road, a minute, or a storm. If a fact is missing, say you don't have it.",
    "You can run the app. go_to when they name a place. Put that place in place.",
    "start_drive when they want to leave on the route already planned.",
    "use_route when they want one of the routes in the packet. Put that route's id in routeId.",
    "radar_on or radar_off for the radar. end_trip when they are done. recenter to center the map.",
    "weather is today's weather on this route. forecast is the weather where the driver is right now, even with no route. traffic is slowdowns, wrecks, and closures on this route. roads lists the highways on it.",
    "explain_ahead for weather, traffic, and hazards. If they name a highway that is not in roads or traffic, say it is not on this route.",
    "Do not reroute around a backup, wreck, or storm. Describe it. You may name another route already in the packet. Do not switch unless they ask.",
    "Mail, jokes, and anything that is not about this trip stay outside. quiet when they want silence. none when you are only talking.",
    "If turnImminent is true, return an empty say and action none.",
    "go_to plans the route. Set drive true only when they want to leave now, not when they only asked to plan.",
    "If you need one missing detail, ask one short question and set clarify to place. Otherwise clarify is empty.",
    'Reply with JSON only: {"say":"...","action":"none|quiet|explain_ahead|go_to|start_drive|use_route|radar_on|radar_off|end_trip|recenter","place":"","routeId":"","drive":false,"clarify":""}.',
  ].join(" ");
}

export function parseStormyModelText(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced?.[1] ?? trimmed).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function clampStormyReply(raw: unknown, packet: StormyPacket): StormyReply {
  if (packet.turnImminent) return SILENT_REPLY;

  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  let action: StormyAction = isAction(obj.action) ? obj.action : "none";
  if (obj.action === "offer_alternate") action = packet.routes.length >= 2 ? "use_route" : "explain_ahead";
  const knownRoute = packet.routes.find((route) => route.id === clip(obj.routeId, 40));
  let routeId = knownRoute?.id ?? "";
  if (action === "use_route" && !routeId && packet.routes.length >= 2) routeId = packet.routes[1]!.id;
  if (action === "use_route" && !routeId) action = "explain_ahead";
  const place = action === "go_to" ? clip(obj.place, STORMY_MAX_LINE) : "";
  if (action === "go_to" && !place) action = "none";
  if (action === "quiet") return QUIET_REPLY;

  let say = clip(obj.say, 2_000);
  if (say.length > STORMY_MAX_SAY_CHARS) {
    const cut = say.slice(0, STORMY_MAX_SAY_CHARS);
    const sentence = Math.max(cut.lastIndexOf("."), cut.lastIndexOf("!"), cut.lastIndexOf("?"));
    say = (sentence > 40 ? cut.slice(0, sentence + 1) : cut).trim();
  }

  return {
    say,
    action,
    needsYes: false,
    place,
    routeId: action === "use_route" ? routeId : "",
    drive: action === "go_to" && obj.drive === true,
    stop: action === "go_to" && obj.stop === true,
    thenPlace: "",
    clarify: action === "none" && obj.clarify === "place" ? "place" : "",
  };
}
