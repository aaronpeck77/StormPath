/**
 * Stormy only speaks from a small trip packet and a fixed action list.
 * She never changes the route. offer_alternate asks; the driver still says yes.
 */

export const STORMY_MODEL = "claude-haiku-5-5";

export const STORMY_ACTIONS = ["none", "quiet", "explain_ahead", "offer_alternate"] as const;

export type StormyAction = (typeof STORMY_ACTIONS)[number];

export const STORMY_MAX_PACKET_CHARS = 6_000;
export const STORMY_MAX_SAY_CHARS = 220;
export const STORMY_MAX_HAZARDS = 6;
export const STORMY_MAX_ROUTES = 3;
export const STORMY_MAX_LINE = 240;

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
};

export type StormyReply = {
  say: string;
  action: StormyAction;
  needsYes: boolean;
};

export type StormyFenceResult =
  | { ok: true; packet: StormyPacket }
  | { ok: false; error: string };

const QUIET_REPLY: StormyReply = { say: "", action: "quiet", needsYes: false };
const SILENT_REPLY: StormyReply = { say: "", action: "none", needsYes: false };

function clip(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
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
  };

  if (JSON.stringify(packet).length > STORMY_MAX_PACKET_CHARS) {
    return { ok: false, error: "That trip packet is too big." };
  }
  return { ok: true, packet };
}

export function stormySystemPrompt(): string {
  return [
    "You are Stormy, the passenger in StormPath.",
    "Use only the trip packet. If a fact is not in it, say you don't know.",
    "Answer in one or two short sentences a driver can hear.",
    "Do not change the route. offer_alternate only when the packet lists more than one route.",
    "If turnImminent is true, return an empty say and action none.",
    'Reply with JSON only: {"say":"...","action":"none|quiet|explain_ahead|offer_alternate"}.',
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
  if (action === "offer_alternate" && packet.routes.length < 2) action = "explain_ahead";
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
    needsYes: action === "offer_alternate",
  };
}
