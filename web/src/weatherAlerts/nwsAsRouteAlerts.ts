import type { RouteAlert } from "../nav/routeAlerts";
import { pointAtAlongMeters, polylineLengthMeters } from "../nav/routeGeometry";
import type { LngLat } from "../nav/types";
import { pointInAnyPolygonGeometry } from "./geometryOverlap";
import { nwsDetailForRouteStrip } from "./nwsDriveSummary";
import type { NormalizedWeatherAlert } from "./types";

function nwsSeverityToScore(sev: string): number {
  switch (sev) {
    case "Extreme":
      return 94;
    case "Severe":
      return 78;
    case "Moderate":
      return 56;
    case "Minor":
      return 34;
    default:
      return 42;
  }
}

/** Compute a [sw, ne] bounding box from a GeoJSON geometry, or null if not possible. */
function polygonBoundsFromGeometry(
  geom: GeoJSON.Geometry | null | undefined
): [[number, number], [number, number]] | undefined {
  if (!geom) return undefined;
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  function visit(coords: number[]) {
    if (coords.length < 2) return;
    if (coords[0]! < minLng) minLng = coords[0]!;
    if (coords[0]! > maxLng) maxLng = coords[0]!;
    if (coords[1]! < minLat) minLat = coords[1]!;
    if (coords[1]! > maxLat) maxLat = coords[1]!;
  }
  function walkRings(rings: number[][][]) { for (const ring of rings) for (const c of ring) visit(c); }
  if (geom.type === "Polygon") walkRings(geom.coordinates);
  else if (geom.type === "MultiPolygon") for (const poly of geom.coordinates) walkRings(poly);
  else if (geom.type === "Point") visit(geom.coordinates);
  else if (geom.type === "MultiPoint" || geom.type === "LineString")
    for (const c of geom.coordinates as number[][]) visit(c);
  if (!isFinite(minLng)) return undefined;
  return [[minLng, minLat], [maxLng, maxLat]];
}

/** Present NWS warnings in the same sheet shape as corridor / map hazards. */
export function normalizedWeatherToRouteAlert(
  n: NormalizedWeatherAlert,
  lngLat: LngLat,
  alongMeters: number
): RouteAlert {
  const detail =
    nwsDetailForRouteStrip(n) || n.description.replace(/\s+/g, " ").trim() || n.headline.trim() || n.areaDesc;
  return {
    id: `nws-strip-${n.id}`,
    severity: nwsSeverityToScore(n.severity),
    title: n.event?.trim() || "Weather alert",
    detail,
    lngLat,
    zoom: 10.5,
    alongMeters,
    promptRerouteAhead: n.severity === "Extreme" || n.severity === "Severe",
    corridorKind: "weather",
    polygonBounds: polygonBoundsFromGeometry(n.geometry ?? null),
  };
}

function stormBandAlertHits(
  geometry: LngLat[],
  startM: number,
  endM: number,
  candidates: NormalizedWeatherAlert[]
): { n: NormalizedWeatherAlert; lngLat: LngLat; alongM: number }[] {
  if (geometry.length < 2 || !candidates.length) return [];
  const total = polylineLengthMeters(geometry);
  if (total < 1) return [];
  const lo = Math.max(0, Math.min(total, Math.min(startM, endM)));
  const hi = Math.max(0, Math.min(total, Math.max(startM, endM)));
  const mid = (lo + hi) / 2;
  const samplesM = [lo, mid, hi].filter((m, i, arr) => i === 0 || m !== arr[i - 1]);

  const byId = new Map<string, { n: NormalizedWeatherAlert; lngLat: LngLat; alongM: number }>();
  for (const m of samplesM) {
    const alongM = Math.max(0, Math.min(total, m));
    const lngLat = pointAtAlongMeters(geometry, alongM);
    for (const n of candidates) {
      if (!n.geometry || !pointInAnyPolygonGeometry(lngLat[0], lngLat[1], n.geometry)) continue;
      const prev = byId.get(n.id);
      if (!prev || prev.alongM > alongM) {
        byId.set(n.id, { n, lngLat, alongM });
      }
    }
  }

  return [...byId.values()].sort((a, b) => nwsSeverityToScore(b.n.severity) - nwsSeverityToScore(a.n.severity));
}

/**
 * NWS alerts whose polygons contain any sample along this distance span on the route
 * (same geometry as strip / map band tap).
 */
export function normalizedAlertsForStormBandSegment(
  geometry: LngLat[],
  startM: number,
  endM: number,
  candidates: NormalizedWeatherAlert[]
): NormalizedWeatherAlert[] {
  return stormBandAlertHits(geometry, startM, endM, candidates).map(({ n }) => n);
}

/** Alerts whose polygons intersect sample points along a storm band (not only the midpoint — avoids empty taps). */
export function routeAlertsFromStormBandMidpoint(
  geometry: LngLat[],
  startM: number,
  endM: number,
  overlapping: NormalizedWeatherAlert[]
): RouteAlert[] {
  return stormBandAlertHits(geometry, startM, endM, overlapping).map(({ n, lngLat, alongM }) =>
    normalizedWeatherToRouteAlert(n, lngLat, alongM)
  );
}
