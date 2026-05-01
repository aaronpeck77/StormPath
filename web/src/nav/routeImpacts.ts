import type { LngLat } from "./types";
import type { RouteAlert, RouteAlertCorridorKind } from "./routeAlerts";
import type { MapboxTrafficLeg } from "../services/mapboxDirectionsTraffic";
import type { RouteSituationSlice } from "../situation/types";
import type { ScoredRoute } from "../scoring/scoreRoutes";
import type { NormalizedWeatherAlert } from "../weatherAlerts";
import {
  chordFractionToAlongMeters,
  pointAtAlongMeters,
  polylineLengthMeters,
} from "./routeGeometry";
import { unifiedTrafficNarrative } from "./trafficNarrative";
import {
  FALLBACK_LNGLAT,
  RADAR_HEAVY_THRESHOLD,
  RADAR_REROUTE_THRESHOLD,
  RADAR_SOFT_THRESHOLD,
  TRAFFIC_PROMPT_REROUTE_MINUTES,
  isSignificantTrafficDelay,
} from "./constants";

/**
 * Shared “Road Ahead” impact: any condition the driver will run into on the active route,
 * regardless of source. Map highlights, progress rail, drive status, and reroute prompts
 * all consume the same `RouteImpact[]` so weather, traffic, closures, and incidents
 * are described consistently.
 */
export type RouteImpactCategory =
  | "weather"
  | "traffic"
  | "closure"
  | "incident"
  | "construction"
  | "visibility"
  | "flooding"
  | "winter"
  | "wind"
  | "other";

export type RouteImpactSeverity = "info" | "caution" | "serious" | "avoid";

export type RouteImpactConfidence = "low" | "medium" | "high";

export type RouteImpactSource =
  | "nws"
  | "radar"
  | "mapboxTraffic"
  | "mapboxIncident"
  | "routeNotice"
  | "fused";

export type RouteImpactAction =
  | "watch"
  | "slow"
  | "prepare"
  | "rerouteAvailable"
  | "rerouteRecommended";

export type RouteImpact = {
  id: string;
  category: RouteImpactCategory;
  severity: RouteImpactSeverity;
  confidence: RouteImpactConfidence;
  source: RouteImpactSource;
  /** Map fly-to / marker. */
  lngLat: LngLat;
  /** Center along route (m). */
  alongMeters: number;
  /** Band start (m) — equals `alongMeters` for point impacts. */
  startMeters: number;
  /** Band end (m) — equals `alongMeters` for point impacts. */
  endMeters: number;
  /** Distance ahead from current position (m); null when unknown. */
  distanceAheadMeters: number | null;
  /** ETA ahead minutes; null when unknown. */
  etaAheadMinutes: number | null;
  /** Short status — what it is (e.g. "Severe storm warning", "Closure ahead"). */
  driverHeadline: string;
  /** What the driver should do. */
  driverAction: RouteImpactAction;
  /** Why it matters to driving — short clause (e.g. "Heavy rain may slow traffic"). */
  roadEffect: string;
  /** Long detail surface for sheets/tooltips. */
  detail: string;
  /** Numeric severity 0..100 — kept so legacy strip / map color code keeps working. */
  numericSeverity: number;
};

const SEVERITY_RANK: Record<RouteImpactSeverity, number> = {
  info: 0,
  caution: 1,
  serious: 2,
  avoid: 3,
};

const ACTION_RANK: Record<RouteImpactAction, number> = {
  watch: 0,
  slow: 1,
  prepare: 2,
  rerouteAvailable: 3,
  rerouteRecommended: 4,
};

export function compareRouteImpactPriority(a: RouteImpact, b: RouteImpact): number {
  const sd = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
  if (sd !== 0) return sd;
  const ad = ACTION_RANK[b.driverAction] - ACTION_RANK[a.driverAction];
  if (ad !== 0) return ad;
  return b.numericSeverity - a.numericSeverity;
}

export function impactSeverityToNumeric(sev: RouteImpactSeverity): number {
  switch (sev) {
    case "avoid":
      return 90;
    case "serious":
      return 75;
    case "caution":
      return 55;
    default:
      return 30;
  }
}

function clampAlong(geometry: LngLat[] | undefined, alongM: number): number {
  if (!geometry?.length) return Math.max(0, alongM);
  const total = polylineLengthMeters(geometry);
  if (total <= 0) return Math.max(0, alongM);
  return Math.max(0, Math.min(total, alongM));
}

function alongToLngLat(geometry: LngLat[] | undefined, alongM: number, fallback: LngLat | null): LngLat {
  if (geometry?.length) return pointAtAlongMeters(geometry, clampAlong(geometry, alongM));
  if (fallback) return fallback;
  return FALLBACK_LNGLAT;
}

/* ─── NWS / weather ──────────────────────────────────────────────── */

function nwsSeverityToImpactSeverity(sev: string): RouteImpactSeverity {
  const t = (sev ?? "").toLowerCase();
  if (/extreme/.test(t)) return "avoid";
  if (/severe/.test(t)) return "serious";
  if (/moderate/.test(t)) return "caution";
  if (/minor/.test(t)) return "info";
  return "caution";
}

function nwsEventClass(event: string): { category: RouteImpactCategory; effect: string } {
  const t = (event ?? "").toLowerCase();
  if (/tornado/.test(t)) {
    return { category: "weather", effect: "Tornado risk on route — be ready to take shelter." };
  }
  if (/flash\s+flood/.test(t)) {
    return { category: "flooding", effect: "Roads can flood quickly — turn around if you see water." };
  }
  if (/flood/.test(t)) {
    return { category: "flooding", effect: "Flooding possible on the corridor — watch for water on the road." };
  }
  if (/hurric|tropical/.test(t)) {
    return { category: "weather", effect: "High wind and heavy rain — slow down significantly." };
  }
  if (/blizzard|ice|freezing|winter|snow|sleet/.test(t)) {
    return { category: "winter", effect: "Slick roads — slow down and leave extra distance." };
  }
  if (/wind|gust/.test(t)) {
    return { category: "wind", effect: "Strong wind — high-profile vehicles use caution." };
  }
  if (/fog|visibility|smoke|dust/.test(t)) {
    return { category: "visibility", effect: "Reduced visibility — slow down and use low beams." };
  }
  if (/thunder|hail/.test(t)) {
    return { category: "weather", effect: "Severe storm on route — heavy rain, hail possible." };
  }
  return { category: "weather", effect: "Weather alert on route — slow down and stay aware." };
}

/** Worst severity wins so a band straddling Watch+Warning reads as Warning. */
function rankNwsSeverity(s: string): number {
  const t = s.toLowerCase();
  if (t.includes("extreme")) return 4;
  if (t.includes("severe")) return 3;
  if (t.includes("moderate")) return 2;
  if (t.includes("minor")) return 1;
  return 0;
}

/** Best-effort: find an NWS alert whose event matches the band's severity label / overlaps the segment. */
function findNwsAlertForBand(
  bandSeverity: string,
  alerts: NormalizedWeatherAlert[]
): NormalizedWeatherAlert | null {
  if (!alerts.length) return null;
  const ranked = alerts
    .filter((a) => rankNwsSeverity(a.severity) >= rankNwsSeverity(bandSeverity))
    .sort((a, b) => rankNwsSeverity(b.severity) - rankNwsSeverity(a.severity));
  return ranked[0] ?? alerts[0] ?? null;
}

export type NwsBandForImpact = {
  startM: number;
  endM: number;
  severity: string;
};

function buildNwsImpacts(opts: {
  geometry: LngLat[] | undefined;
  bands: NwsBandForImpact[];
  alerts: NormalizedWeatherAlert[];
  userAlongM: number;
  planEtaMinutes: number | null | undefined;
  totalMeters: number;
  userLngLat: LngLat | null;
}): RouteImpact[] {
  const { geometry, bands, alerts, userAlongM, planEtaMinutes, totalMeters, userLngLat } = opts;
  if (!bands.length) return [];

  return bands.map((b, i): RouteImpact => {
    const center = (b.startM + b.endM) / 2;
    const matchingAlert = findNwsAlertForBand(b.severity, alerts);
    const event = matchingAlert?.event ?? `${b.severity} weather on route`;
    const cls = nwsEventClass(event);
    const sev = nwsSeverityToImpactSeverity(matchingAlert?.severity ?? b.severity);
    const aheadM = Math.max(0, center - userAlongM);
    const insideNow = userAlongM + 12 >= b.startM && userAlongM - 12 <= b.endM;
    const distanceAheadMeters = insideNow ? 0 : aheadM;
    const etaAheadMinutes =
      totalMeters > 0 && planEtaMinutes != null && Number.isFinite(planEtaMinutes)
        ? Math.max(0, planEtaMinutes * (distanceAheadMeters / totalMeters))
        : null;

    const driverAction: RouteImpactAction = (() => {
      if (sev === "avoid") return "rerouteRecommended";
      if (sev === "serious") return "prepare";
      if (sev === "caution") return "slow";
      return "watch";
    })();

    return {
      id: `nws-${i}`,
      category: cls.category,
      severity: sev,
      confidence: "high",
      source: "nws",
      lngLat: alongToLngLat(geometry, center, userLngLat),
      alongMeters: center,
      startMeters: b.startM,
      endMeters: b.endM,
      distanceAheadMeters,
      etaAheadMinutes,
      driverHeadline: insideNow
        ? `${event} — in this segment`
        : `${event} ahead`,
      driverAction,
      roadEffect: cls.effect,
      detail: matchingAlert?.headline?.trim() || matchingAlert?.description?.slice(0, 220) || cls.effect,
      numericSeverity: impactSeverityToNumeric(sev),
    };
  });
}

/* ─── Radar / heavy precip (no NWS overlay) ─────────────────────── */

function buildRadarImpact(opts: {
  geometry: LngLat[] | undefined;
  radarIntensity: number;
  forecastHeadline: string;
  corridorWeatherDetail: string;
  userAlongM: number;
  planEtaMinutes: number | null | undefined;
  totalMeters: number;
  userLngLat: LngLat | null;
  /** Skip when the route already has an NWS band (NWS is more authoritative). */
  hasNwsBand: boolean;
}): RouteImpact | null {
  const { radarIntensity, hasNwsBand, geometry, totalMeters } = opts;
  if (hasNwsBand) return null;
  if (radarIntensity < RADAR_SOFT_THRESHOLD) return null;

  const veryHeavy = radarIntensity >= 0.9;
  const heavy = radarIntensity >= RADAR_HEAVY_THRESHOLD;
  const sev: RouteImpactSeverity = veryHeavy ? "serious" : heavy ? "caution" : "info";
  const action: RouteImpactAction =
    radarIntensity >= RADAR_REROUTE_THRESHOLD ? "prepare" : heavy ? "slow" : "watch";

  const alongM = totalMeters * 0.52;
  const aheadM = Math.max(0, alongM - opts.userAlongM);
  const eta =
    totalMeters > 0 && opts.planEtaMinutes != null && Number.isFinite(opts.planEtaMinutes)
      ? Math.max(0, opts.planEtaMinutes * (aheadM / totalMeters))
      : null;

  const detailCore =
    opts.corridorWeatherDetail.trim() ||
    opts.forecastHeadline.trim() ||
    "Precipitation in the corridor";

  return {
    id: "radar",
    category: "weather",
    severity: sev,
    confidence: "medium",
    source: "radar",
    lngLat: alongToLngLat(geometry, alongM, opts.userLngLat),
    alongMeters: alongM,
    startMeters: alongM,
    endMeters: alongM,
    distanceAheadMeters: aheadM,
    etaAheadMinutes: eta,
    driverHeadline: veryHeavy ? "Heavy rain on route" : heavy ? "Rain on route" : "Light rain on route",
    driverAction: action,
    roadEffect: heavy
      ? "Heavy rain — slow down and leave extra following distance."
      : "Wet pavement possible — watch for hydroplaning.",
    detail: detailCore,
    numericSeverity: Math.round(50 + radarIntensity * 30),
  };
}

/* ─── Mapbox traffic ─────────────────────────────────────────────── */

function trafficNumericToSeverity(numeric: number, hasClosure: boolean): RouteImpactSeverity {
  if (hasClosure) return "avoid";
  if (numeric >= 82) return "serious";
  if (numeric >= 60) return "caution";
  return "info";
}

function buildTrafficImpact(opts: {
  geometry: LngLat[] | undefined;
  slice: RouteSituationSlice | undefined;
  trafficLeg: MapboxTrafficLeg | null;
  trafficForRoute: ScoredRoute | undefined;
  userAlongM: number;
  planEtaMinutes: number | null | undefined;
  totalMeters: number;
  userLngLat: LngLat | null;
}): RouteImpact | null {
  const { slice, trafficLeg, trafficForRoute, userAlongM, totalMeters, geometry } = opts;
  const delay = slice?.trafficDelayMinutes ?? trafficForRoute?.trafficDelayMinutes ?? 0;
  const remainingMin =
    trafficLeg?.mapboxDurationMinutes ?? trafficForRoute?.effectiveEtaMinutes ?? null;
  const hasLive = Boolean(slice?.hasLiveTrafficEstimate && trafficLeg);
  const story = unifiedTrafficNarrative(delay, trafficLeg, hasLive, remainingMin);
  if (!story.shouldAddCorridorAlert) return null;

  const chordT = trafficLeg?.nearStopFraction ?? 0.38;
  const along = totalMeters * chordT;
  const aheadM = Math.max(0, along - userAlongM);
  const eta =
    totalMeters > 0 && opts.planEtaMinutes != null && Number.isFinite(opts.planEtaMinutes)
      ? Math.max(0, opts.planEtaMinutes * (aheadM / totalMeters))
      : null;

  const sev = trafficNumericToSeverity(story.mapSeverity, Boolean(trafficLeg?.hasClosure));
  const significant = isSignificantTrafficDelay(delay, remainingMin);
  /* Confidence: high when we have a real near-stop anchor; medium when overall delay is only inferred from the polyline. */
  const confidence: RouteImpactConfidence = trafficLeg?.hasClosure
    ? "high"
    : trafficLeg?.nearStopFraction != null
      ? "high"
      : hasLive
        ? "medium"
        : "low";

  let action: RouteImpactAction = "slow";
  if (trafficLeg?.hasClosure) action = "rerouteRecommended";
  else if (delay >= TRAFFIC_PROMPT_REROUTE_MINUTES && significant && confidence !== "low") {
    action = "rerouteRecommended";
  } else if (delay >= 4 && significant) action = "rerouteAvailable";
  else if (delay >= 1) action = "slow";

  const detailGlue = [story.advisorySubtext, story.mapDetail].filter(Boolean).join(" ");

  return {
    id: trafficLeg?.hasClosure ? "closure-traffic" : "traffic-delay",
    category: trafficLeg?.hasClosure ? "closure" : "traffic",
    severity: sev,
    confidence,
    source: "mapboxTraffic",
    lngLat: alongToLngLat(geometry, along, opts.userLngLat),
    alongMeters: along,
    startMeters: along,
    endMeters: along,
    distanceAheadMeters: aheadM,
    etaAheadMinutes: eta,
    driverHeadline: story.advisoryHeadline,
    driverAction: action,
    roadEffect: trafficLeg?.hasClosure
      ? "Road blocked — alternate route may be needed."
      : "Stop-and-go ahead — ease off and add following distance.",
    detail: detailGlue.trim() || story.mapDetail,
    numericSeverity: story.mapSeverity,
  };
}

/* ─── Route notices / hazards / construction / closures ─────────── */

type SliceHazard = { kind: "closure" | "incident" | "lowVisibility" | "restriction"; summary: string; alongMeters?: number };

function hazardLikelyBlocksPath(summary: string): boolean {
  return /\b(blocked|impassable|all lanes? (closed|blocked)|road closed|closure|closed ahead|detour)\b/i.test(
    summary
  );
}

function classifyHazard(h: SliceHazard): {
  category: RouteImpactCategory;
  severity: RouteImpactSeverity;
  confidence: RouteImpactConfidence;
  action: RouteImpactAction;
  headline: string;
  effect: string;
} {
  const blocks = hazardLikelyBlocksPath(h.summary) || h.kind === "closure";
  const construction = /\b(construction|road work|lane\s*closure|work zone)\b/i.test(h.summary);

  if (h.kind === "closure") {
    return {
      category: "closure",
      severity: "avoid",
      confidence: "high",
      action: "rerouteRecommended",
      headline: "Closure ahead",
      effect: "Road closed — reroute to keep moving.",
    };
  }
  if (h.kind === "incident") {
    return {
      category: "incident",
      severity: blocks ? "serious" : "caution",
      confidence: "high",
      action: blocks ? "rerouteRecommended" : "slow",
      headline: blocks ? "Crash blocking road" : "Incident ahead",
      effect: blocks
        ? "Lanes blocked — alternate route may save time."
        : "Slowdown ahead — stay alert.",
    };
  }
  if (construction) {
    return {
      category: "construction",
      severity: blocks ? "serious" : "caution",
      confidence: "high",
      action: blocks ? "rerouteAvailable" : "slow",
      headline: blocks ? "Construction blocking lane" : "Construction zone",
      effect: "Work zone — slow down and watch for crews.",
    };
  }
  if (h.kind === "lowVisibility") {
    return {
      category: "visibility",
      severity: "caution",
      confidence: "medium",
      action: "slow",
      headline: "Low visibility ahead",
      effect: "Reduced visibility — slow down and use low beams.",
    };
  }
  return {
    category: "incident",
    severity: blocks ? "serious" : "caution",
    confidence: "medium",
    action: blocks ? "rerouteAvailable" : "slow",
    headline: blocks ? "Road notice — possible block" : "Road notice ahead",
    effect: "Caution ahead — adjust speed and lane.",
  };
}

function buildHazardImpacts(opts: {
  geometry: LngLat[] | undefined;
  hazards: SliceHazard[];
  userAlongM: number;
  planEtaMinutes: number | null | undefined;
  totalMeters: number;
  userLngLat: LngLat | null;
}): RouteImpact[] {
  const { geometry, hazards, userAlongM, totalMeters, userLngLat } = opts;
  const out: RouteImpact[] = [];
  const max = Math.min(hazards.length, 5);
  for (let i = 0; i < max; i++) {
    const h = hazards[i]!;
    const cls = classifyHazard(h);
    const anchored =
      typeof h.alongMeters === "number" &&
      Number.isFinite(h.alongMeters) &&
      geometry?.length &&
      totalMeters > 0;
    const chordT = 0.22 + (i % 5) * 0.11;
    const alongM = anchored ? Math.max(0, Math.min(totalMeters, h.alongMeters!)) : totalMeters * chordT;
    const aheadM = Math.max(0, alongM - userAlongM);
    const eta =
      totalMeters > 0 && opts.planEtaMinutes != null && Number.isFinite(opts.planEtaMinutes)
        ? Math.max(0, opts.planEtaMinutes * (aheadM / totalMeters))
        : null;
    out.push({
      id: `hazard-${h.kind}-${i}`,
      category: cls.category,
      severity: cls.severity,
      confidence: anchored ? cls.confidence : cls.confidence === "high" ? "medium" : cls.confidence,
      source: "routeNotice",
      lngLat: alongToLngLat(geometry, alongM, userLngLat),
      alongMeters: alongM,
      startMeters: alongM,
      endMeters: alongM,
      distanceAheadMeters: aheadM,
      etaAheadMinutes: eta,
      driverHeadline: cls.headline,
      driverAction: cls.action,
      roadEffect: cls.effect,
      detail: h.summary,
      numericSeverity: impactSeverityToNumeric(cls.severity),
    });
  }
  return out;
}

/* ─── Top-level builder ──────────────────────────────────────────── */

export type BuildRouteImpactsOpts = {
  geometry: LngLat[] | undefined;
  userLngLat: LngLat | null;
  /** User position projected to route polyline (m). 0 if not navigating. */
  userAlongM: number;
  /** Static plan ETA — used to convert distance-ahead into time-ahead. */
  planEtaMinutes: number | null | undefined;
  slice: RouteSituationSlice | undefined;
  trafficForRoute: ScoredRoute | undefined;
  trafficLeg: MapboxTrafficLeg | null;
  /** Forecast / corridor weather text for the radar impact's detail line. */
  corridorWeatherDetail?: string;
  /** NWS bands along this route polyline. */
  nwsBands: NwsBandForImpact[];
  /** NWS alerts overlapping the corridor — used to pick a real event title for each band. */
  nwsAlerts: NormalizedWeatherAlert[];
};

export function buildRouteImpacts(opts: BuildRouteImpactsOpts): RouteImpact[] {
  const {
    geometry,
    userLngLat,
    userAlongM,
    planEtaMinutes,
    slice,
    trafficForRoute,
    trafficLeg,
    corridorWeatherDetail = "",
    nwsBands,
    nwsAlerts,
  } = opts;

  const totalMeters = geometry?.length ? polylineLengthMeters(geometry) : 0;
  const radarIntensity = slice?.radarIntensity ?? 0;
  const forecastHeadline = slice?.forecastHeadline ?? "";

  const list: RouteImpact[] = [];

  const nwsImpacts = buildNwsImpacts({
    geometry,
    bands: nwsBands,
    alerts: nwsAlerts,
    userAlongM,
    planEtaMinutes,
    totalMeters,
    userLngLat,
  });
  list.push(...nwsImpacts);

  const radarImpact = buildRadarImpact({
    geometry,
    radarIntensity,
    forecastHeadline,
    corridorWeatherDetail,
    userAlongM,
    planEtaMinutes,
    totalMeters,
    userLngLat,
    hasNwsBand: nwsImpacts.length > 0,
  });
  if (radarImpact) list.push(radarImpact);

  const trafficImpact = buildTrafficImpact({
    geometry,
    slice,
    trafficLeg,
    trafficForRoute,
    userAlongM,
    planEtaMinutes,
    totalMeters,
    userLngLat,
  });
  if (trafficImpact) list.push(trafficImpact);

  const hazardImpacts = buildHazardImpacts({
    geometry,
    hazards: (slice?.hazards ?? []) as SliceHazard[],
    userAlongM,
    planEtaMinutes,
    totalMeters,
    userLngLat,
  });
  list.push(...hazardImpacts);

  list.sort(compareRouteImpactPriority);
  return list;
}

/* ─── Back-compat: project an impact to the existing RouteAlert shape ─── */

function impactToCorridorKind(i: RouteImpact): RouteAlertCorridorKind {
  switch (i.category) {
    case "weather":
    case "winter":
    case "wind":
    case "flooding":
    case "visibility":
      return "weather";
    case "closure":
    case "incident":
    case "construction":
      return "hazard";
    case "traffic":
      return "traffic";
    default:
      return "notice";
  }
}

export function routeImpactToRouteAlert(i: RouteImpact): RouteAlert {
  const promptRerouteAhead =
    i.driverAction === "rerouteAvailable" || i.driverAction === "rerouteRecommended";
  return {
    id: i.id,
    severity: i.numericSeverity,
    title: i.driverHeadline,
    detail: i.detail || i.roadEffect,
    lngLat: i.lngLat,
    zoom: i.category === "traffic" ? 12.4 : i.category === "weather" ? 11.5 : 12.6,
    alongMeters: i.alongMeters,
    promptRerouteAhead,
    corridorKind: impactToCorridorKind(i),
  };
}

/** Pick the top reroute-recommended impact ahead of the user (for bypass gating). */
export function pickRerouteImpactAhead(
  impacts: RouteImpact[],
  windowMeters: number
): RouteImpact | null {
  let best: RouteImpact | null = null;
  for (const i of impacts) {
    if (i.driverAction !== "rerouteRecommended" && i.driverAction !== "rerouteAvailable") continue;
    const ahead = i.distanceAheadMeters;
    if (ahead == null || ahead <= 0 || ahead > windowMeters) continue;
    if (i.confidence === "low") continue;
    if (best == null) {
      best = i;
      continue;
    }
    if (compareRouteImpactPriority(i, best) < 0) best = i;
  }
  return best;
}

/* Tiny helper kept in this module so the legacy `RouteAlert` shape can pass through layout helpers. */
export { chordFractionToAlongMeters };
