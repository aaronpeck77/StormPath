import type { LngLat } from "./types";
import { haversineMeters, initialBearingDegrees } from "./routeGeometry";
import type { NormalizedWeatherAlert } from "../weatherAlerts/types";
import { pointInAnyPolygonGeometry, rankNwsSeverity } from "../weatherAlerts/geometryOverlap";

/** Max extra drive time vs fastest route before storm detour is rejected (soft cap). */
export const STORM_AVOIDANCE_MAX_ETA_FACTOR = 1.38;

/** Project `bearingDeg` from (lng,lat) by `distanceM` on the spheroid (metres). */
function destinationPoint(lng: number, lat: number, bearingDeg: number, distanceM: number): LngLat {
  const R = 6371000;
  const d = distanceM / R;
  const b = (bearingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(b) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
    );
  return [(lng2 * 180) / Math.PI, (lat2 * 180) / Math.PI];
}

function polygonCentroid(coords: GeoJSON.Position[][]): LngLat {
  const ring = coords[0] ?? [];
  if (!ring.length) return [0, 0];
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p[0]!;
    y += p[1]!;
  }
  return [x / ring.length, y / ring.length];
}

function geometryCentroid(g: GeoJSON.Polygon | GeoJSON.MultiPolygon): LngLat {
  if (g.type === "Polygon") return polygonCentroid(g.coordinates);
  return polygonCentroid(g.coordinates[0] ?? [[]]);
}

/** Polygon threats worth steering around on the highway network (warnings / high severity). */
function alertSteersRouting(a: NormalizedWeatherAlert): boolean {
  if (!a.geometry) return false;
  const ev = (a.event ?? "").toLowerCase();
  /* Broad watches cover huge areas — poor waypoint anchors. */
  if (/\bwatch\b/.test(ev) && !/\bwarning\b/.test(ev)) return false;

  if (
    /tornado warning|severe thunderstorm warning|flash flood warning|flash flood emergency|extreme wind warning|snow squall warning|blizzard warning|ice storm warning|dust storm warning|hurricane warning|typhoon warning|tropical storm warning/i.test(
      ev
    )
  ) {
    return true;
  }
  return rankNwsSeverity(a.severity) >= 3; /* Severe / Extreme */
}

function projectedAlongFrac(origin: LngLat, dest: LngLat, p: LngLat): number {
  const ox = origin[0]!;
  const oy = origin[1]!;
  const dx = dest[0]! - ox;
  const dy = dest[1]! - oy;
  const px = p[0]! - ox;
  const py = p[1]! - oy;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-14) return 0;
  return (px * dx + py * dy) / len2;
}

/** True if alert polygon is relevant to an OD trip (between endpoints, near chord). */
function alertThreatensOdChord(origin: LngLat, dest: LngLat, a: NormalizedWeatherAlert): boolean {
  const g = a.geometry;
  if (!g) return false;
  const tripLen = haversineMeters(origin, dest);
  if (tripLen < 3000) return false;

  const steps = 40;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const lng = origin[0]! + (dest[0]! - origin[0]!) * t;
    const lat = origin[1]! + (dest[1]! - origin[1]!) * t;
    if (pointInAnyPolygonGeometry(lng, lat, g)) return true;
  }

  const c = geometryCentroid(g);
  const frac = projectedAlongFrac(origin, dest, c);
  if (frac < -0.12 || frac > 1.12) return false;
  const chordMid: LngLat = [(origin[0]! + dest[0]!) / 2, (origin[1]! + dest[1]!) / 2];
  const maxDist = Math.min(320_000, 0.42 * tripLen + 95_000);
  return haversineMeters(chordMid, c) <= maxDist * 1.15;
}

function crossTrackSign(origin: LngLat, dest: LngLat, p: LngLat): number {
  return (dest[0]! - origin[0]!) * (p[1]! - origin[1]!) - (dest[1]! - origin[1]!) * (p[0]! - origin[0]!);
}

function threatsForStormRouting(origin: LngLat, dest: LngLat, alerts: NormalizedWeatherAlert[]) {
  const threats = alerts.filter(
    (a) => alertSteersRouting(a) && alertThreatensOdChord(origin, dest, a)
  );
  threats.sort((a, b) => {
    const sd = rankNwsSeverity(b.severity) - rankNwsSeverity(a.severity);
    if (sd !== 0) return sd;
    const ca = geometryCentroid(a.geometry!);
    const cb = geometryCentroid(b.geometry!);
    const ma = Math.abs(projectedAlongFrac(origin, dest, ca) - 0.5);
    const mb = Math.abs(projectedAlongFrac(origin, dest, cb) - 0.5);
    return ma - mb;
  });
  return threats;
}

function waypointFromEscapeBearing(
  origin: LngLat,
  dest: LngLat,
  threats: NormalizedWeatherAlert[],
  escapeBearDeg: number,
  offsetScale: number
): LngLat {
  const tripM = haversineMeters(origin, dest);
  const mid: LngLat = [(origin[0]! + dest[0]!) / 2, (origin[1]! + dest[1]!) / 2];
  const offsetM = Math.min(92_000, Math.max(38_000, 0.19 * tripM)) * offsetScale;

  let wp = destinationPoint(mid[0]!, mid[1]!, escapeBearDeg, offsetM);

  for (let bump = 0; bump < 3; bump++) {
    let inside = false;
    for (const a of threats) {
      const g = a.geometry!;
      if (pointInAnyPolygonGeometry(wp[0], wp[1], g)) {
        inside = true;
        break;
      }
    }
    if (!inside) break;
    wp = destinationPoint(wp[0], wp[1], escapeBearDeg, 22_000);
  }

  return wp;
}

/** Drop near-duplicate waypoints before issuing Directions requests. */
export function dedupeWaypointCandidates(points: LngLat[], minSeparationM: number): LngLat[] {
  const out: LngLat[] = [];
  for (const p of points) {
    if (out.every((q) => haversineMeters(p, q) >= minSeparationM)) out.push(p);
  }
  return out;
}

/** Several perpendicular offsets per threatening polygon mass — scored downstream against radar mosaic. */
export function computeStormAvoidanceWaypointVariants(
  origin: LngLat,
  dest: LngLat,
  alerts: NormalizedWeatherAlert[]
): LngLat[] {
  const threats = threatsForStormRouting(origin, dest, alerts);
  if (!threats.length) return [];

  const centroid = geometryCentroid(threats[0]!.geometry!);
  const bearingOd = initialBearingDegrees(origin, dest);
  const side = crossTrackSign(origin, dest, centroid);
  const escapeA = side >= 0 ? (bearingOd + 90) % 360 : (bearingOd - 90 + 360) % 360;
  const escapeB = (escapeA + 180) % 360;

  /* Prefer legacy scale (=1) first so behaviour matches prior single-waypoint picks when radar ties. */
  const scales = [1, 0.78, 1.18];
  const raw: LngLat[] = [];
  for (const esc of [escapeA, escapeB]) {
    for (const sc of scales) {
      raw.push(waypointFromEscapeBearing(origin, dest, threats, esc, sc));
    }
  }
  return dedupeWaypointCandidates(raw, 2200);
}

/**
 * Corridor lateral offsets without NWS geometry — used when radar shows strong echoes but polygons are absent/outdated.
 */
export function computeRadarBypassWaypointCandidates(origin: LngLat, dest: LngLat): LngLat[] {
  const tripM = haversineMeters(origin, dest);
  if (tripM < 3000) return [];

  const bearingOd = initialBearingDegrees(origin, dest);
  const mid: LngLat = [(origin[0]! + dest[0]!) / 2, (origin[1]! + dest[1]!) / 2];
  const baseOffset = Math.min(88_000, Math.max(34_000, 0.175 * tripM));
  const bears = [(bearingOd + 90) % 360, (bearingOd - 90 + 360) % 360];
  const scales = [0.58, 0.88, 1.12, 1.38];
  const raw: LngLat[] = [];
  for (const b of bears) {
    for (const sc of scales) {
      raw.push(destinationPoint(mid[0]!, mid[1]!, b, baseOffset * sc));
    }
  }
  return dedupeWaypointCandidates(raw, 2200);
}

/**
 * Pick one waypoint **between** origin and destination that steers around NWS polygons that
 * threaten the straight corridor. Uses a perpendicular offset from trip midpoint away from the
 * dominant polygon centroid — heuristic only; Mapbox Directions snaps it to roads.
 *
 * Returns null when no actionable polygon threat exists.
 */
export function computeStormAvoidanceWaypoint(
  origin: LngLat,
  dest: LngLat,
  alerts: NormalizedWeatherAlert[]
): LngLat | null {
  const threats = threatsForStormRouting(origin, dest, alerts);
  if (!threats.length) return null;

  const centroid = geometryCentroid(threats[0]!.geometry!);
  const bearingOd = initialBearingDegrees(origin, dest);
  const side = crossTrackSign(origin, dest, centroid);
  const escapeBear = side >= 0 ? (bearingOd + 90) % 360 : (bearingOd - 90 + 360) % 360;

  return waypointFromEscapeBearing(origin, dest, threats, escapeBear, 1);
}

/** True when any steering alert threatens the OD corridor — adaptive reroute effects gate on this. */
export function hasAdaptiveStormThreatAlongTrip(
  user: LngLat,
  dest: LngLat,
  alerts: NormalizedWeatherAlert[]
): boolean {
  return alerts.some((a) => alertSteersRouting(a) && alertThreatensOdChord(user, dest, a));
}

/** Quantized OD + sorted alert mass fingerprint for storm-aware reroute triggers. */
export function stormAdaptiveRoutingSignature(
  user: LngLat,
  dest: LngLat,
  alerts: NormalizedWeatherAlert[]
): string {
  const gridLng = Math.round(user[0]! * 72) / 72;
  const gridLat = Math.round(user[1]! * 72) / 72;
  const od = `${gridLng.toFixed(4)},${gridLat.toFixed(4)}→${dest[0]!.toFixed(4)},${dest[1]!.toFixed(4)}`;
  const threats = alerts.filter(
    (a) => alertSteersRouting(a) && alertThreatensOdChord(user, dest, a)
  );
  const mass = threats
    .map((a) => {
      const c = geometryCentroid(a.geometry!);
      return `${a.id}:${c[0]!.toFixed(3)},${c[1]!.toFixed(3)}`;
    })
    .sort()
    .join("|");
  return `${od}#${mass}`;
}
