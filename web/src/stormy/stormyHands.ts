import type { StormyPacket, StormyReply } from "./stormyFence";
import { answerStormySituation } from "./stormySituation";

const EMPTY = { needsYes: false, place: "", routeId: "", drive: false } as const;

function reply(say: string, action: StormyReply["action"], extra?: Partial<StormyReply>): StormyReply {
  return { say, action, ...EMPTY, ...extra };
}

/**
 * Clear passenger commands, so she can work the app even when the model
 * only wanted to talk. Anything she is not sure about stays with the model.
 */
export function interpretStormyRequest(question: string, packet: StormyPacket): StormyReply | null {
  const q = question.replace(/\s+/g, " ").trim();
  if (!q) return null;
  const lower = q.toLowerCase().replace(/[.!?]+$/g, "").trim();

  if (/^(?:please )?(?:be quiet|quiet|hush|stop talking)$/.test(lower)) {
    return reply("", "quiet");
  }
  if (isStop(lower)) {
    if (!packet.driving && packet.routes.length === 0) return reply("There's no trip to stop.", "none");
    return reply("Trip's done.", "end_trip");
  }
  if (/^(?:please )?(?:turn )?radar on$/.test(lower) || lower === "show radar") {
    return reply("Radar's on.", "radar_on");
  }
  if (/^(?:please )?(?:turn )?radar off$/.test(lower) || lower === "hide radar") {
    return reply("Radar's off.", "radar_off");
  }
  if (/^(?:please )?(?:recenter|center(?: the)? map|center on me)$/.test(lower)) {
    return reply("Centered on you.", "recenter");
  }
  if (/\bdestination\b/.test(lower) && /\b(?:set|pick|choose|change)\b/.test(lower) && !placeFrom(q)) {
    return reply("Where do you want to go?", "none");
  }

  const place = placeFrom(q);
  if (place) {
    return reply(place.drive ? `Heading to ${place.place}.` : `Planning a route to ${place.place}.`, "go_to", {
      place: place.place,
      drive: place.drive,
    });
  }

  if (
    /\b(?:hit go|press go|start (?:the )?(?:drive|driving|navigation|trip|route)|let's go|lets go)\b/.test(lower) ||
    lower === "go" ||
    lower === "go ahead"
  ) {
    return reply("Let's go.", "start_drive");
  }

  const labeled = lower.match(/^(?:please\s+)?(?:take |use |switch to )?route ([abc])$/);
  if (labeled?.[1]) {
    const label = labeled[1].toUpperCase();
    const found = packet.routes.find((route) => route.label.toUpperCase() === label);
    if (found) return reply(`Taking route ${label}.`, "use_route", { routeId: found.id });
  }

  if (/^(?:please )?(?:the other route|other route|switch routes)$/.test(lower) && packet.routes[1]) {
    const next = packet.routes[1];
    return reply(`Taking ${next.label}.`, "use_route", { routeId: next.id });
  }

  return answerStormySituation(q, packet);
}

function isStop(lower: string): boolean {
  if (/\b(talking|talk)\b/.test(lower)) return false;
  if (/^(?:please )?(?:stop|cancel|end it)$/.test(lower)) return true;
  return /\b(?:stop|end|cancel|clear)\b/.test(lower) && /\b(?:route|trip|navigation|drive|driving)\b/.test(lower);
}

function placeFrom(question: string): { place: string; drive: boolean } | null {
  const patterns = [
    /\bdestination\s+(?:to|for|as|is)\s+(?!me\b)(.+)$/i,
    /\b(?:plan|make|build|get|start|give me|find)(?:\s+(?:a|the|me))?\s+(?:route|trip|directions)(?:\s+(?:to|for))?\s+(.+)$/i,
    /\b(?:take me|drive me|get me|navigate|head|go|drive|driving)\s+to\s+(.+)$/i,
    /\bi (?:need|want|wanna|would like) to go to\s+(.+)$/i,
    /\b(?:directions to|route to|navigate to)\s+(.+)$/i,
  ];
  for (const pattern of patterns) {
    const match = question.match(pattern);
    const cleaned = match?.[1] ? cleanPlace(match[1]) : null;
    if (cleaned?.place && !/^(?:me|us)$/i.test(cleaned.place)) {
      const leaveNow = /\b(?:take me|drive me|get me|navigate|head|go|drive|driving)\s+to\b/i.test(question);
      return { place: cleaned.place, drive: cleaned.drive || leaveNow };
    }
  }
  return null;
}

function cleanPlace(raw: string): { place: string; drive: boolean } {
  let place = raw.replace(/[.!?]+$/g, "").trim();
  const drive = /\b(?:hit go|press go|let's go|lets go|start driving|and go)\b/i.test(place);
  place = place
    .replace(/\s+(?:and\s+)?(?:then\s+)?(?:hit go|press go|start driving|let's go|lets go|and go)\b.*$/i, "")
    .trim();
  place = place.replace(/^(?:the|a)\s+/i, "").trim();
  return { place, drive };
}
