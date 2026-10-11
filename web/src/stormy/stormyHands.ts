import type { StormyPacket, StormyReply } from "./stormyFence";
import { answerStormySituation } from "./stormySituation";
import { asksAboutStormyVoice, STORMY_VOICE_HINT } from "./stormyVoiceHint";

const EMPTY = { needsYes: false, place: "", routeId: "", drive: false, stop: false, thenPlace: "", clarify: "" } as const;

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
  if (asksAboutStormyVoice(lower)) {
    return reply(STORMY_VOICE_HINT, "none");
  }
  if (/\bdestination\b/.test(lower) && /\b(?:set|pick|choose|change)\b/.test(lower) && !placeFrom(q)) {
    return reply("Where do you want to go?", "none", { clarify: "place" });
  }

  const two = twoPlaces(q);
  if (two) {
    return reply(`First ${two.stop}, then ${two.dest}.`, "go_to", {
      place: two.stop,
      thenPlace: two.dest,
      stop: true,
      drive: false,
    });
  }

  const errand = errandPlace(q, lower);
  if (errand) return goErrand(errand, packet);
  if (/\badd a stop\b/.test(lower)) {
    return reply("What should I add as a stop?", "none", { clarify: "place", stop: true });
  }

  const place = placeFrom(q);
  if (place) {
    const asStop = onATrip(packet) && looksLikeErrand(place.place);
    return reply(asStop ? `Adding a stop at ${place.place}.` : place.drive ? `Heading to ${place.place}.` : `Planning a route to ${place.place}.`, "go_to", {
      place: place.place,
      drive: asStop ? packet.driving : place.drive,
      stop: asStop,
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

/** "Gas station then Walmart" is a stop plus a final destination. The app allows one stop. */
function twoPlaces(question: string): { stop: string; dest: string } | null {
  const match = question.match(
    /\b(?:take me|drive me|get me|navigate|head|go|i (?:want|wanna|need|would like|'d like) to go)\s+to\s+(.+?)\s+(?:and\s+)?then\s+(?:(?:go|head)\s+)?(?:to\s+)?(.+)$/i
  );
  if (!match?.[1] || !match[2]) return null;
  const stop = tidyPlace(match[1]);
  const dest = tidyPlace(match[2]);
  if (!stop || !dest) return null;
  if (/^(?:me|us)$/i.test(stop) || /^(?:me|us)$/i.test(dest)) return null;
  return { stop, dest };
}

function tidyPlace(raw: string): string {
  const cleaned = cleanPlace(raw).place;
  return cleaned
    .replace(/\b(?:in|at)\s+the\s+(?:city|town)\s+closest\s+to\s+me\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function onATrip(packet: StormyPacket): boolean {
  return packet.driving || packet.routes.length > 0 || packet.destination.trim().length > 0;
}

function goErrand(place: string, packet: StormyPacket): StormyReply {
  const asStop = onATrip(packet);
  return reply(asStop ? `Adding a stop for ${place}.` : `Looking for ${place}.`, "go_to", {
    place,
    drive: packet.driving,
    stop: asStop,
  });
}

function looksLikeErrand(place: string): boolean {
  return /\b(?:coffee|cafe|starbucks|dunkin|restaurant|mcdonald|food|gas|fuel)\b/i.test(place);
}

function errandPlace(question: string, lower: string): string | null {
  if (!/\b(?:coffee|cafe|starbucks|dunkin|eat|food|hungry|lunch|dinner|breakfast|restaurant|gas|fuel)\b/.test(lower)) {
    return null;
  }
  const specific = question.match(/\b(?:stop at|add a stop (?:at|for)|stop for|grab|get some|get a|get)\s+(.+)$/i);
  const added = question.match(/\b(?:add|find|search for)\s+(?:me\s+)?(?:a|an|the\s+)?(.+)$/i);
  const named = specific?.[1] ?? added?.[1];
  if (named) {
    const place = cleanPlace(named).place;
    if (place && !/^(?:me|us|some|a|the|place|somewhere|something)(?:\s+to\s+eat)?$/i.test(place)) return place;
  }
  if (/\b(?:coffee|cafe|starbucks|dunkin)\b/.test(lower)) return "coffee";
  if (/\b(?:gas|fuel)\b/.test(lower)) return "gas station";
  if (/\b(?:eat|food|hungry|lunch|dinner|breakfast|restaurant)\b/.test(lower)) return "restaurant";
  return null;
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
