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
  if (packet.turnImminent) return null;
  const q = question.replace(/\s+/g, " ").trim();
  if (!q) return null;
  const lower = q.toLowerCase().replace(/[.!?]+$/g, "").trim();

  if (/^(?:please )?(?:be quiet|quiet|hush|stop talking)$/.test(lower)) {
    return reply("", "quiet");
  }
  if (/^(?:please )?(?:end(?: the)? trip|cancel(?: the)? trip|stop navigation|we're done|we are done)$/.test(lower)) {
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
  if (/^(?:please )?(?:let's go|lets go|start driving|hit go|start navigation)$/.test(lower) || lower === "go") {
    return reply("Let's go.", "start_drive");
  }

  const going = q.match(
    /^(?:please\s+)?(?:plan (?:a |the )?(?:route|trip) to|route to|directions to|take me to|go to|navigate to|drive to|head to|get me to)\s+(.+)$/i
  );
  if (going?.[1]) {
    const place = going[1].replace(/[.!?]+$/g, "").trim();
    const drive = /^(?:please\s+)?(?:take me to|navigate to|drive to|head to|get me to|go to)\b/i.test(q);
    if (place) {
      return reply(drive ? `Heading to ${place}.` : `Planning a route to ${place}.`, "go_to", {
        place,
        drive,
      });
    }
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
