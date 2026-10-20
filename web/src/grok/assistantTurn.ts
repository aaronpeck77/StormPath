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

/** Facts StormPath already measured, so the assistant does not invent the road or the storm. */
export function assistantBrief(question: string, packet: StormyPacket): string {
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
  return `The driver said: ${question.replace(/\s+/g, " ").trim()}. StormPath measured: ${facts}. Talk in your own words. For the road and the weather, use only these measured facts. To change the trip, use the StormPath tools. Call start_drive when they ask to leave, and stop_drive when they ask to stop.`.slice(
    0,
    900
  );
}
