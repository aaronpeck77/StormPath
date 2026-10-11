import { STORMY_MAX_SAY_CHARS, type StormyPacket, type StormyReply } from "./stormyFence";
import { spokenPlace } from "./spokenPlace";

export const STORMY_MAX_WEATHER = 4;
export const STORMY_MAX_TRAFFIC = 4;
export const STORMY_MAX_ROADS = 8;

const WEATHER = new Set(["weather", "visibility", "flooding", "winter", "wind"]);
const TRAFFIC = new Set(["traffic", "closure", "incident", "construction"]);

export type StormyImpactFact = {
  category: string;
  driverHeadline: string;
  roadEffect?: string;
  distanceAheadMeters?: number | null;
};

const EMPTY_REPLY = { needsYes: false, place: "", routeId: "", drive: false, stop: false, clarify: "" } as const;

export function stormyFactsFromImpacts(
  impacts: StormyImpactFact[],
  useMiles: boolean
): { weather: string[]; traffic: string[] } {
  const weather: string[] = [];
  const traffic: string[] = [];
  for (const impact of impacts) {
    const line = formatFact(impact, useMiles);
    if (!line) continue;
    if (WEATHER.has(impact.category) && weather.length < STORMY_MAX_WEATHER) weather.push(line);
    else if (TRAFFIC.has(impact.category) && traffic.length < STORMY_MAX_TRAFFIC) traffic.push(line);
  }
  return { weather, traffic };
}

export function stormyRoadRefs(steps: { roadRef?: string; roadName?: string }[] | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const step of steps ?? []) {
    for (const raw of [step.roadRef, step.roadName]) {
      const token = tokenIn(raw ?? "");
      if (!token || seen.has(token)) continue;
      seen.add(token);
      out.push(displayRoad(token));
      if (out.length >= STORMY_MAX_ROADS) return out;
    }
  }
  return out;
}

/** Weather, traffic, and “stay with the drive.” Null when the model should answer. */
export function answerStormySituation(question: string, packet: StormyPacket): StormyReply | null {
  const lower = question.toLowerCase().replace(/[.!?]+$/g, "").trim();
  if (!lower) return null;

  const trip = answerTripDetail(lower, packet);
  if (trip) return trip;

  if (/\b(email|e-mail|text my|who won|tell me a joke|play a song)\b/.test(lower)) {
    return say("I'll stay with the trip.", "none");
  }

  const around =
    /\b(reroute|re-route|go around|way around|route around|get around|avoid the|bypass)\b/.test(lower) &&
    /\b(traffic|wreck|wrecks|backup|backups|jam|jams|block|blocked|closure|closed|storm|weather|hazard|crash|accident)\b/.test(
      lower
    );
  if (around) {
    const lead = packet.traffic[0] ? spoken([packet.traffic[0]]) : "";
    const other = packet.routes[1];
    const tail = other
      ? `Route ${other.label} is already up if you want it.`
      : "I can't take us around it yet.";
    return say([lead, tail].filter(Boolean).join(" "), "explain_ahead");
  }

  if (
    /\b(local forecast|forecast here|weather here|weather right now|my forecast)\b/.test(lower) ||
    (/\blocal\b/.test(lower) && /\b(forecast|weather)\b/.test(lower))
  ) {
    return say(
      packet.forecast ? `Right now, ${packet.forecast.replace(/[.!?]+$/g, "")}.` : "I don't have a local forecast yet.",
      "explain_ahead"
    );
  }

  const wantsWeather = /\b(weather|forecast|rain|snow|storms?|fog|wind|icy)\b/.test(lower);
  const road = roadTokenFromSpeech(lower);
  const wantsTraffic =
    road != null ||
    /\b(traffic|backup|backups|wreck|wrecks|accident|jam|jams|congestion|slowdown|closure|closed|crash)\b/.test(lower);
  if (!wantsWeather && !wantsTraffic) return null;

  const parts: string[] = [];
  if (wantsWeather) parts.push(weatherLine(packet));
  if (wantsTraffic) parts.push(trafficLine(packet, road));
  return say(spoken(parts), "explain_ahead");
}

function answerTripDetail(lower: string, packet: StormyPacket): StormyReply | null {
  if (/\b(?:how long|how much longer|eta|time left|when do we get|how far|miles left|how many miles)\b/.test(lower)) {
    if (!packet.eta && !packet.milesLeft) return say("I don't have a time for this trip yet.", "explain_ahead");
    const time = packet.eta ? `About ${packet.eta} left` : "I don't have a time";
    const far = packet.milesLeft ? `, ${packet.milesLeft}` : "";
    const dest = packet.destination ? `. Still going to ${spokenPlace(packet.destination, packet.here)}` : "";
    return say(`${time}${far}${dest}.`, "explain_ahead");
  }
  if (/\b(?:where are we going|where we going|what's the destination|whats the destination|where to)\b/.test(lower)) {
    if (!packet.destination) return say("No destination yet. Tell me where you want to go.", "explain_ahead");
    const stop = packet.stops[0] ? ` We'll stop at ${spokenPlace(packet.stops[0], packet.here)} on the way.` : "";
    return say(`We're going to ${spokenPlace(packet.destination, packet.here)}.${stop}`, "explain_ahead");
  }
  if (
    /\b(?:tell me about|how's|hows|how is|what's ahead|whats ahead|what do i need to know|what should i know)\b/.test(
      lower
    ) &&
    /\b(?:trip|drive|route|ahead|rest)\b/.test(lower)
  ) {
    return say(tripBrief(packet), "explain_ahead");
  }
  return null;
}

function tripBrief(packet: StormyPacket): string {
  const parts: string[] = [];
  if (packet.destination) parts.push(`We're going to ${spokenPlace(packet.destination, packet.here)}.`);
  if (packet.eta || packet.milesLeft) {
    parts.push([packet.eta ? `About ${packet.eta} left` : "", packet.milesLeft].filter(Boolean).join(", ") + ".");
  }
  if (packet.stops[0]) parts.push(`There's a stop at ${spokenPlace(packet.stops[0], packet.here)}.`);
  if (packet.weather[0]) parts.push(packet.weather[0].endsWith(".") ? packet.weather[0] : `${packet.weather[0]}.`);
  else if (packet.forecast) parts.push(`Right here it's ${packet.forecast.replace(/[.]+$/g, "")}.`);
  if (packet.traffic[0]) parts.push(packet.traffic[0].endsWith(".") ? packet.traffic[0] : `${packet.traffic[0]}.`);
  else if (packet.routes.length) parts.push("Traffic is clear on this route.");
  if (!parts.length) return "Set a destination and I can walk you through the trip.";
  return parts.slice(0, 4).join(" ");
}

function weatherLine(packet: StormyPacket): string {
  if (packet.weather.length) return spoken(packet.weather);
  if (!hasTrip(packet)) return "Set a destination, and I'll read the weather on the way.";
  return "I don't have weather on this route yet.";
}

function trafficLine(packet: StormyPacket, road: string | null): string {
  if (road) {
    const label = displayRoad(road);
    const onRoute = mentions(packet.roads, road) || mentions(packet.traffic, road);
    const named = packet.traffic.filter((line) => mentions([line], road));
    if (!onRoute) return `${label} isn't on this route.`;
    if (named.length) return spoken(named);
    return `${label} is on our route, and it's clear.`;
  }
  if (packet.traffic.length) return spoken(packet.traffic);
  if (!hasTrip(packet)) return "Set a destination, and I'll read the traffic.";
  return "Traffic is clear on this route.";
}

function hasTrip(packet: StormyPacket): boolean {
  return (
    packet.routes.length > 0 ||
    packet.weather.length > 0 ||
    packet.traffic.length > 0 ||
    packet.roads.length > 0
  );
}

function formatFact(impact: StormyImpactFact, useMiles: boolean): string {
  const headline = impact.driverHeadline.replace(/\s+/g, " ").trim();
  if (!headline) return "";
  const effect = (impact.roadEffect ?? "").replace(/\s+/g, " ").trim();
  const where = aheadPhrase(impact.distanceAheadMeters, useMiles);
  const parts = [headline];
  if (effect && !squash(headline).includes(squash(effect).slice(0, 18))) parts.push(effect);
  if (where) parts.push(where);
  return parts.join(", ").slice(0, 240);
}

function aheadPhrase(meters: number | null | undefined, useMiles: boolean): string {
  if (meters == null || !Number.isFinite(meters) || meters < 0) return "";
  if (meters < 500) return "right ahead";
  if (useMiles) {
    const miles = meters / 1609.344;
    if (miles < 1) return "under a mile ahead";
    return `${Math.round(miles)} miles ahead`;
  }
  return `${Math.max(1, Math.round(meters / 1000))} kilometers ahead`;
}

function spoken(lines: string[]): string {
  let text = lines
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(" ");
  if (!text) return "";
  if (!/[.!?]$/.test(text)) text += ".";
  if (text.length <= STORMY_MAX_SAY_CHARS) return text;
  const cut = text.slice(0, STORMY_MAX_SAY_CHARS - 1);
  const sentence = Math.max(cut.lastIndexOf("."), cut.lastIndexOf("!"));
  return (sentence > 40 ? cut.slice(0, sentence + 1) : cut).trim();
}

function say(text: string, action: StormyReply["action"]): StormyReply {
  return { say: spoken([text]), action, ...EMPTY_REPLY };
}

function squash(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function roadTokenFromSpeech(text: string): string | null {
  return tokenIn(text);
}

function tokenIn(text: string): string | null {
  const match = text.toLowerCase().match(/\b(?:interstate|i|us)[\s-]?\d{1,3}\b/);
  if (!match) return null;
  const token = match[0].replace(/interstate/g, "i").replace(/[^a-z0-9]/g, "");
  return /^(?:i|us)\d{1,3}$/.test(token) ? token : null;
}

function displayRoad(token: string): string {
  const interstate = token.match(/^i(\d{1,3})$/);
  if (interstate) return `I-${interstate[1]}`;
  const us = token.match(/^us(\d{1,3})$/);
  if (us) return `US-${us[1]}`;
  return token.toUpperCase();
}

function mentions(lines: string[], token: string): boolean {
  return lines.some((line) => line.toLowerCase().replace(/interstate/g, "i").replace(/[^a-z0-9]/g, "").includes(token));
}
