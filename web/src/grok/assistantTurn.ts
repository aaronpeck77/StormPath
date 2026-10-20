import type { StormyAction, StormyPacket } from "../stormy/stormyFence";

const HANDS = new Set<StormyAction>([
  "quiet",
  "go_to",
  "start_drive",
  "use_route",
  "radar_on",
  "radar_off",
  "end_trip",
  "recenter",
  "refresh",
]);

/** Look up a place, Go, and stop run on the phone. Open talk goes to the assistant. */
export function isTripAction(action: StormyAction): boolean {
  return HANDS.has(action);
}

const TRIP_TALK =
  /\b(weather|forecast|rain|raining|snow|snowing|storm|radar|temperature|wind|icy|fog|traffic|wreck|jam|backup|closure|hazard|eta|how long|how much longer|how far|miles left|time left|when do we (?:get|arrive)|where are we going|where we going|what(?:'s| is) ahead|how(?:'s| is) the (?:road|drive|trip)|destination|which route|the route|our route|reroute|add a stop|take me|drive me|navigate|directions to|start the drive|stop the (?:trip|route))\b/i;

/** They asked about this trip or the weather. Anything else is ordinary conversation. */
export function isTripTalk(question: string): boolean {
  return TRIP_TALK.test(question.replace(/\s+/g, " ").trim());
}

/** The words the driver spoke, without the measured trip pasted on the end. */
export function driverSaid(raw: string): string {
  const text = raw.replace(/\s+/g, " ").trim();
  const marked = text.match(/the driver said:\s*(.*?)(?:\.\s*(?:stormpath measured:|this is free talk\b)|$)/i);
  const said = (marked?.[1] ?? text).replace(/[.]+$/g, "").trim();
  return said || text;
}

/**
 * The on-phone script speaks only when no assistant is connected.
 * A failed send must not be filled in by that script.
 */
export function fallbackSpeech(dockCode: string, localSay: string): string | null {
  if (dockCode.trim()) return null;
  const line = localSay.replace(/\s+/g, " ").trim();
  return line || null;
}

/** Facts StormPath already measured, so the assistant does not invent the road or the storm. */
export function assistantBrief(question: string, packet: StormyPacket): string {
  const said = question.replace(/\s+/g, " ").trim();
  if (!isTripTalk(said)) {
    return `The driver said: ${said}. This is free talk. Answer as you normally would. Do not mention the route, the weather, the traffic, or the drive unless they asked.`.slice(
      0,
      900
    );
  }
  const facts = [
    packet.driving ? "The drive is already going." : "The drive has not started.",
    packet.destination ? `Destination: ${packet.destination}.` : "No destination yet.",
    packet.eta ? `Time left: ${packet.eta}.` : "",
    packet.milesLeft ? `Distance left: ${packet.milesLeft}.` : "",
    packet.here ? `The driver is near ${packet.here}.` : "",
    packet.aheadLine ? `Ahead: ${packet.aheadLine}.` : "",
    packet.weather.slice(0, 3).join(" "),
    packet.traffic.slice(0, 3).join(" "),
    packet.forecast,
  ]
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ");
  return `The driver said: ${said}. StormPath measured: ${facts}. These measurements are what StormPath knows about the trip.`.slice(
    0,
    900
  );
}
