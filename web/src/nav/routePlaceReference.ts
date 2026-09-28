import type { LngLat, RouteTurnStep } from "./types";
import { haversineMeters, pointAtAlongMeters } from "./routeGeometry";
import { placeNameFromDestinations, placeNameFromInstruction } from "./turnInstructionShort";

const MI = 1609.344;
/** A town farther than this is not a useful landmark for one alert. */
const MAX_TOWN_M = 40 * MI;
/** An exit farther than this is just another mile marker. */
const MAX_EXIT_M = 15 * MI;
/** Inside this, the exit is the specific landmark and beats a farther town. */
const EXIT_WINS_M = 8 * MI;

export type RoutePlaceAnchor = {
  lngLat: LngLat;
  place: string | null;
  exitNumber: string | null;
};

export function buildRoutePlaceAnchors(
  steps: RouteTurnStep[] | undefined,
  geometry: LngLat[] | undefined
): RoutePlaceAnchor[] {
  if (!steps?.length || !geometry || geometry.length < 2) return [];
  let along = 0;
  const out: RoutePlaceAnchor[] = [];
  for (const step of steps) {
    const place = step.towardPlace?.trim() || placeNameFromInstruction(step.instruction) || null;
    const exitNumber = step.exitNumber?.trim() || null;
    if (place || exitNumber) {
      out.push({
        lngLat: pointAtAlongMeters(geometry, along),
        place,
        exitNumber,
      });
    }
    along += step.distanceM != null && Number.isFinite(step.distanceM) ? step.distanceM : 0;
  }
  return out;
}

function bearingDeg(from: LngLat, to: LngLat): number {
  const φ1 = (from[1] * Math.PI) / 180;
  const φ2 = (to[1] * Math.PI) / 180;
  const Δλ = ((to[0] - from[0]) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

function cardinal(from: LngLat, to: LngLat): "north" | "east" | "south" | "west" {
  const d = ((bearingDeg(from, to) % 360) + 360) % 360;
  if (d >= 45 && d < 135) return "east";
  if (d >= 135 && d < 225) return "south";
  if (d >= 225 && d < 315) return "west";
  return "north";
}

function phraseFor(
  anchor: RoutePlaceAnchor,
  meters: number,
  card: "north" | "east" | "south" | "west",
  mode: "full" | "nearby"
): string {
  const place = anchor.place;
  const exit = anchor.exitNumber;
  const mi = Math.max(1, Math.round(meters / MI));
  if (mode === "nearby") {
    if (exit && place) return `Exit ${exit} toward ${place}`;
    if (exit) return `Exit ${exit}`;
    if (place && meters < MI) return `just ${card} of ${place}`;
    return `${card} of ${place}`;
  }
  if (exit && place) {
    if (meters < 1200) return `Exit ${exit} toward ${place}`;
    return `${mi} mi ${card} of Exit ${exit} toward ${place}`;
  }
  if (exit) {
    if (meters < 800) return `at Exit ${exit}`;
    return `${mi} mi ${card} of Exit ${exit}`;
  }
  if (meters < 800 && place) return `at ${place}`;
  if (meters < 1200 && place) return `just ${card} of ${place}`;
  return `${mi} mi ${card} of ${place}`;
}

/**
 * One landmark for an alert.
 * A nearby exit (and the town on its sign) wins when you're close to it.
 * Otherwise the nearest city or town within 40 miles.
 */
export function placeReferencePhrase(
  hazard: LngLat,
  anchors: RoutePlaceAnchor[],
  mode: "full" | "nearby" = "full"
): string | null {
  let town: { anchor: RoutePlaceAnchor; meters: number } | null = null;
  let exit: { anchor: RoutePlaceAnchor; meters: number } | null = null;
  for (const anchor of anchors) {
    const meters = haversineMeters(anchor.lngLat, hazard);
    if (!Number.isFinite(meters)) continue;
    if (anchor.place && !anchor.exitNumber && meters <= MAX_TOWN_M && (!town || meters < town.meters)) {
      town = { anchor, meters };
    }
    if (anchor.exitNumber && meters <= MAX_EXIT_M && (!exit || meters < exit.meters)) {
      exit = { anchor, meters };
    }
  }
  const pick = exit && exit.meters <= EXIT_WINS_M ? exit : town ?? exit;
  if (!pick) return null;
  return phraseFor(pick.anchor, pick.meters, cardinal(pick.anchor.lngLat, hazard), mode);
}

/** Keep the miles-ahead line, and add one landmark when it still fits. */
export function locationWithPlace(
  locationLine: string,
  phrase: string | null | undefined,
  label?: string | null
): string {
  if (!phrase) return locationLine;
  if (/^(Now|Passed)/.test(locationLine)) return locationLine;
  const named = phrase.match(/\b(?:of|toward|at)\s+(.+)$/)?.[1]?.trim();
  if (named && label && label.toLowerCase().includes(named.toLowerCase())) return locationLine;
  const next = `${locationLine} · ${phrase}`;
  if (next.length <= 72) return next;
  const compact = phrase.replace(/^\d+\s+mi\s+/, "");
  const shorter = `${locationLine} · ${compact}`;
  if (shorter.length <= 72 && compact !== phrase) return shorter;
  return locationLine;
}

export function placePhraseMatchingSpan(
  items: { startMeters: number; endMeters: number; placePhrase?: string | null }[] | null | undefined,
  startMeters: number,
  endMeters: number
): string | null {
  if (!items?.length) return null;
  const mid = (startMeters + endMeters) / 2;
  let best: (typeof items)[number] | null = null;
  let bestD = Infinity;
  for (const item of items) {
    const d = Math.abs((item.startMeters + item.endMeters) / 2 - mid);
    if (d < bestD) {
      bestD = d;
      best = item;
    }
  }
  if (!best || bestD > 500) return null;
  return best.placePhrase ?? null;
}

export { placeNameFromDestinations };
