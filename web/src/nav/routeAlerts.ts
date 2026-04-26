import type { LngLat } from "./types";
import {
  chordFractionToAlongMeters,
  pointAtAlongMeters,
  polylineLengthMeters,
} from "./routeGeometry";
import type { ScoredRoute } from "../scoring/scoreRoutes";
import type { MapboxTrafficLeg } from "../services/mapboxDirectionsTraffic";
import type { RouteSituationSlice } from "../situation/types";
import { pointAlongPolyline } from "../ui/geometryAlong";
import { FALLBACK_LNGLAT, MAX_STRIP_ALERTS, RADAR_HEAVY_THRESHOLD } from "./constants";
import { unifiedTrafficNarrative } from "./trafficNarrative";

/** Drives map + progress-strip segment color (distinct from destination dots). */
export type RouteAlertCorridorKind = "weather" | "hazard" | "notice" | "traffic";

export type RouteAlert = {
  id: string;
  severity: number;
  title: string;
  detail: string;
  lngLat: LngLat;
  zoom: number;
  /** Approximate distance from route start along the selected polyline (meters). */
  alongMeters: number;
  /** Include in drive-mode “within 5 mi” reroute prompts. */
  promptRerouteAhead: boolean;
  corridorKind: RouteAlertCorridorKind;
};

/** Half-length of highlighted segment on map + strip (meters each side of alert position). */
export const ROUTE_CORRIDOR_HIGHLIGHT_HALF_SPAN_M = 400;

/** Map + progress strip segment color for corridor alerts (NWS polygons use separate severity colors on the map). */
export function corridorHighlightHex(kind: RouteAlertCorridorKind, severity: number): string {
  if (kind === "weather") {
    return severity >= 70 ? "#7c3aed" : "#0ea5e9";
  }
  if (kind === "hazard") {
    return severity >= 80 ? "#dc2626" : severity >= 60 ? "#ea580c" : "#f59e0b";
  }
  if (kind === "traffic") {
    return severity >= 80 ? "#dc2626" : severity >= 58 ? "#ea580c" : "#f59e0b";
  }
  return severity >= 48 ? "#475569" : "#94a3b8";
}

function fallbackPoint(geometry: LngLat[] | undefined, userLngLat: LngLat | null, t: number): LngLat {
  const p = geometry?.length ? pointAlongPolyline(geometry, t) : null;
  if (p) return p;
  if (userLngLat) return userLngLat;
  return FALLBACK_LNGLAT;
}

function alongM(geometry: LngLat[] | undefined, chordT: number): number {
  if (!geometry?.length) return 0;
  return chordFractionToAlongMeters(geometry, chordT);
}

function hazardLikelyBlocksPath(summary: string): boolean {
  return /\b(blocked|impassable|all lanes? (closed|blocked)|road closed|closure|closed ahead|detour)\b/i.test(summary);
}

export type BuildRouteAlertsOpts = {
  /** Extra wx text for the radar/heavy-weather corridor (temp, precip, samples along route). */
  corridorWeatherDetail?: string;
  /** Raw leg diagnostics from Mapbox traffic for near-stop positioning. */
  trafficLeg?: MapboxTrafficLeg | null;
};

export function buildRouteAlerts(
  geometry: LngLat[] | undefined,
  userLngLat: LngLat | null,
  slice: RouteSituationSlice | undefined,
  trafficForRoute: ScoredRoute | undefined,
  _mapboxForTraffic: boolean,
  _trafficFetchDone: boolean,
  opts?: BuildRouteAlertsOpts
): RouteAlert[] {
  const list: RouteAlert[] = [];
  const delay = slice?.trafficDelayMinutes ?? trafficForRoute?.trafficDelayMinutes ?? 0;
  const hazards = slice?.hazards ?? [];
  const radar = slice?.radarIntensity ?? 0;
  const forecast = slice?.forecastHeadline ?? "";
  const extraWx = opts?.corridorWeatherDetail?.trim() ?? "";
  const mergedWx = [extraWx, forecast].filter(Boolean).join(" · ").replace(/\s+/g, " ").trim();

  const trafficLeg = opts?.trafficLeg ?? null;
  const remainingMin =
    trafficLeg?.mapboxDurationMinutes ?? trafficForRoute?.effectiveEtaMinutes ?? null;
  const hasLiveTraffic = Boolean(slice?.hasLiveTrafficEstimate && trafficLeg);
  const trafficStory = unifiedTrafficNarrative(delay, trafficLeg, hasLiveTraffic, remainingMin);
  if (trafficStory.shouldAddCorridorAlert) {
    const chordT = trafficLeg?.nearStopFraction ?? 0.38;
    list.push({
      id: "traffic-delay",
      severity: trafficStory.mapSeverity,
      title: trafficStory.mapTitle,
      detail: trafficStory.mapDetail,
      lngLat: fallbackPoint(geometry, userLngLat, chordT),
      zoom: 12.4,
      alongMeters: alongM(geometry, chordT),
      promptRerouteAhead: true,
      corridorKind: "traffic",
    });
  }

  if (radar >= RADAR_HEAVY_THRESHOLD) {
    const chordT = 0.52;
    const detailCore = mergedWx || forecast || "Precipitation in the corridor";
    const veryHeavy = radar >= 0.9;
    list.push({
      id: "radar",
      severity: Math.min(78, 50 + radar * 22),
      title: veryHeavy ? "Heavy weather on route" : "Rain on route",
      detail: `${detailCore} — compare routes or open Hazards for NWS + radar.`,
      lngLat: fallbackPoint(geometry, userLngLat, chordT),
      zoom: 11.5,
      alongMeters: alongM(geometry, chordT),
      promptRerouteAhead: true,
      corridorKind: "weather",
    });
  }

  const routeLenM = geometry?.length ? polylineLengthMeters(geometry) : 0;

  /* Router / incident notices → map + progress-strip corridors (do not skip: slice hazards match routeNotices text). */
  hazards.forEach((h, i) => {
    if (i > 4) return;
    const chordT = 0.22 + (i % 5) * 0.11;
    const constr = /\b(construction|road work|lane\s*closure|work zone)\b/i.test(h.summary);
    const blocksPath = hazardLikelyBlocksPath(h.summary) || h.kind === "closure";
    let severity = 52;
    if (h.kind === "closure") severity = 88;
    else if (h.kind === "restriction") severity = blocksPath ? 82 : 64;
    else if (h.kind === "incident") severity = blocksPath ? 80 : 62;
    else if (h.kind === "lowVisibility") severity = 52;
    const title =
      h.kind === "closure"
        ? "Closure"
        : h.kind === "restriction"
          ? constr
            ? "Construction / work zone"
            : "Road notice"
          : "Notice";
    const anchored =
      typeof h.alongMeters === "number" &&
      Number.isFinite(h.alongMeters) &&
      geometry?.length &&
      routeLenM > 0;
    const alongDist = anchored
      ? Math.max(0, Math.min(routeLenM, h.alongMeters!))
      : alongM(geometry, chordT);
    const lngLat = anchored ? pointAtAlongMeters(geometry!, alongDist) : fallbackPoint(geometry, userLngLat, chordT);
    list.push({
      id: `hazard-${h.kind}-${i}`,
      severity,
      title,
      detail: h.summary,
      lngLat,
      zoom: 12.6,
      alongMeters: alongDist,
      promptRerouteAhead: h.kind === "closure" || h.kind === "incident",
      corridorKind: "hazard",
    });
  });

  list.sort((a, b) => b.severity - a.severity);
  return list;
}

/**
 * Strip layout: road notices / construction outrank generic traffic so they stay visible under MAX_STRIP_ALERTS.
 */
export function augmentAlertsForProgressStrip(base: RouteAlert[]): RouteAlert[] {
  const hazardsStrip = base.filter((a) => a.id.startsWith("hazard-"));
  const restStrip = base.filter((a) => !a.id.startsWith("hazard-"));
  hazardsStrip.sort((a, b) => b.severity - a.severity);
  restStrip.sort((a, b) => b.severity - a.severity);
  return [...hazardsStrip, ...restStrip].slice(0, MAX_STRIP_ALERTS);
}
