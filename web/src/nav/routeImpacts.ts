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
import { unifiedTrafficNarrative, hasLocalizedTrafficIssue } from "./trafficNarrative";
import {
  FALLBACK_LNGLAT,
  RADAR_SOFT_THRESHOLD,
  TRAFFIC_PROMPT_REROUTE_MINUTES,
  isSignificantTrafficDelay,
} from "./constants";
import { classifyRadarEcho, radarDisplayIntensity } from "./radarReflectivityScale";

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
  | "tomorrowIo"
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
      detail:
        matchingAlert?.headline?.trim() ||
        matchingAlert?.description?.replace(/\s+/g, " ").trim() ||
        cls.effect,
      numericSeverity: impactSeverityToNumeric(sev),
    };
  });
}

/* ─── Radar / heavy precip (no NWS overlay) ─────────────────────── */

export type RadarMosaicSample = { t: number; intensity: number };

/** Merge nearby mosaic samples so the timeline shows bands, not one chip per sample. */
const RADAR_MERGE_GAP_T = 0.14;

type RadarMosaicBand = { startT: number; endT: number; maxIntensity: number };

export function mergeRadarMosaicBands(samples: RadarMosaicSample[]): RadarMosaicBand[] {
  const above = samples
    .filter((s) => radarDisplayIntensity(s.intensity) >= RADAR_SOFT_THRESHOLD)
    .sort((a, b) => a.t - b.t);
  if (!above.length) return [];
  const out: RadarMosaicBand[] = [];
  let cur: RadarMosaicBand = {
    startT: above[0]!.t,
    endT: above[0]!.t,
    maxIntensity: above[0]!.intensity,
  };
  for (let i = 1; i < above.length; i++) {
    const s = above[i]!;
    if (s.t - cur.endT <= RADAR_MERGE_GAP_T) {
      cur.endT = Math.max(cur.endT, s.t);
      cur.maxIntensity = Math.max(cur.maxIntensity, s.intensity);
    } else {
      out.push(cur);
      cur = { startT: s.t, endT: s.t, maxIntensity: s.intensity };
    }
  }
  out.push(cur);
  return out;
}

/** RainViewer mosaic spans for the progress strip / map when NWS polygons are missing or lagging. */
export function radarMosaicToProgressStripBands(
  totalM: number,
  samples: RadarMosaicSample[]
): { startM: number; endM: number; lineHex: string; severity: string }[] {
  if (totalM <= 0 || !samples.length) return [];
  return mergeRadarMosaicBands(samples).map((b) => {
    const echo = classifyRadarEcho(b.maxIntensity);
    return {
      startM: totalM * Math.max(0, Math.min(1, b.startT)),
      endM: totalM * Math.max(b.startT, Math.min(1, b.endT)),
      lineHex: echo?.stripHex ?? "#64748b",
      severity: echo?.stripLabel ?? "Trace",
    };
  });
}

function radarHeadlineForBand(maxIntensity: number, spanFrac: number): string {
  return classifyRadarEcho(maxIntensity, spanFrac)?.headline ?? "Light showers possible";
}

/**
 * Strip the verbose "Start: X°F conditions → Quarter: ... → Destination: ..." chain
 * from corridor detail text. That breakdown is already shown in the progress graph —
 * it's too much to read in an advisory card while driving.
 */
function stripRouteSegmentChain(detail: string): string {
  const SEGMENT_LABEL = /^(Start|Quarter|Midway|3\/4 mark|Destination)\b/i;
  return detail
    .split(/\s*·\s*/)
    .filter((part) => {
      const t = part.trim();
      return t.length > 0 && !SEGMENT_LABEL.test(t) && !t.includes(" → ");
    })
    .join(" · ")
    .trim();
}

function buildRadarImpact(opts: {
  geometry: LngLat[] | undefined;
  radarIntensity: number;
  forecastHeadline: string;
  corridorWeatherDetail: string;
  userAlongM: number;
  planEtaMinutes: number | null | undefined;
  totalMeters: number;
  userLngLat: LngLat | null;
  /** Skip single mid-route card when NWS bands already cover the corridor. */
  hasNwsBand: boolean;
  /** Optional along-route fraction from RainViewer mosaic (0..1). */
  alongFraction?: number;
  /** Band span (mosaic merge) — when set, start/end meters frame the graph band. */
  startFraction?: number;
  endFraction?: number;
  idSuffix?: string;
}): RouteImpact | null {
  const { radarIntensity, hasNwsBand, geometry, totalMeters } = opts;
  if (hasNwsBand && opts.alongFraction == null && opts.startFraction == null) return null;

  const spanFrac = (() => {
    if (
      opts.startFraction != null &&
      opts.endFraction != null &&
      Number.isFinite(opts.startFraction) &&
      Number.isFinite(opts.endFraction) &&
      totalMeters > 0
    ) {
      const startM = totalMeters * Math.max(0, Math.min(1, opts.startFraction));
      const endM = totalMeters * Math.max(startM, Math.min(1, opts.endFraction));
      return (endM - startM) / totalMeters;
    }
    return 0;
  })();
  const echo = classifyRadarEcho(radarIntensity, spanFrac);
  if (!echo) return null;

  const { severity: sev, action, roadEffect, numericSeverity } = echo;

  let startM: number;
  let endM: number;
  if (
    opts.startFraction != null &&
    opts.endFraction != null &&
    Number.isFinite(opts.startFraction) &&
    Number.isFinite(opts.endFraction) &&
    totalMeters > 0
  ) {
    startM = totalMeters * Math.max(0, Math.min(1, opts.startFraction));
    endM = totalMeters * Math.max(startM, Math.min(1, opts.endFraction));
    if (endM - startM < totalMeters * 0.02) endM = Math.min(totalMeters, startM + totalMeters * 0.02);
  } else {
    const alongM =
      opts.alongFraction != null && Number.isFinite(opts.alongFraction)
        ? totalMeters * Math.max(0, Math.min(1, opts.alongFraction))
        : totalMeters * 0.52;
    startM = alongM;
    endM = alongM;
  }
  const alongM = (startM + endM) / 2;
  const bandSpanFrac = totalMeters > 0 ? (endM - startM) / totalMeters : spanFrac;
  const aheadM = Math.max(0, startM - opts.userAlongM);
  const eta =
    totalMeters > 0 && opts.planEtaMinutes != null && Number.isFinite(opts.planEtaMinutes)
      ? Math.max(0, opts.planEtaMinutes * (aheadM / totalMeters))
      : null;

  const detailCore =
    stripRouteSegmentChain(opts.corridorWeatherDetail.trim()) ||
    stripRouteSegmentChain(opts.forecastHeadline.trim()) ||
    "Precipitation in the corridor";

  return {
    id: opts.idSuffix ? `radar-${opts.idSuffix}` : "radar",
    category: "weather",
    severity: sev,
    confidence: "medium",
    source: "radar",
    lngLat: alongToLngLat(geometry, alongM, opts.userLngLat),
    alongMeters: alongM,
    startMeters: startM,
    endMeters: endM,
    distanceAheadMeters: aheadM,
    etaAheadMinutes: eta,
    driverHeadline: radarHeadlineForBand(radarIntensity, bandSpanFrac),
    driverAction: action,
    roadEffect,
    detail: detailCore,
    numericSeverity,
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
  if (!hasLive || !trafficLeg) return null;

  const story = unifiedTrafficNarrative(delay, trafficLeg, hasLive, remainingMin);
  if (!hasLocalizedTrafficIssue(trafficLeg)) {
    return null;
  }
  const significant = isSignificantTrafficDelay(delay, remainingMin);
  const sev = trafficNumericToSeverity(story.mapSeverity, Boolean(trafficLeg.hasClosure));
  const confidence: RouteImpactConfidence = trafficLeg.hasClosure
    ? "high"
    : trafficLeg.nearStopFraction != null
      ? "high"
      : trafficLeg.firstHeavyCongestionFraction != null
        ? "medium"
        : "low";

  let action: RouteImpactAction = "watch";
  if (trafficLeg.hasClosure) action = "rerouteRecommended";
  else if (delay >= TRAFFIC_PROMPT_REROUTE_MINUTES && significant && confidence !== "low") {
    action = "rerouteRecommended";
  } else if (delay >= 4 && significant) action = "rerouteAvailable";
  else if (delay >= 1) action = "slow";

  const detailGlue = [story.advisorySubtext, story.mapDetail].filter(Boolean).join(" ");

  let startM: number;
  let endM: number;
  let alongM: number;
  let aheadM: number;
  let roadEffect: string;
  let id = "traffic-corridor";

  if (trafficLeg.hasClosure) {
    id = "closure-traffic";
    const anchorT = trafficLeg.nearStopFraction ?? trafficLeg.firstHeavyCongestionFraction ?? 0.55;
    alongM = totalMeters * anchorT;
    startM = alongM;
    endM = alongM;
    aheadM = Math.max(0, alongM - userAlongM);
    roadEffect = "Road blocked — alternate route may be needed.";
  } else if (trafficLeg.nearStopFraction != null) {
    id = "traffic-delay";
    alongM = totalMeters * trafficLeg.nearStopFraction;
    startM = alongM;
    endM = alongM;
    aheadM = Math.max(0, alongM - userAlongM);
    roadEffect = "Stop-and-go ahead — ease off and add following distance.";
    action = action === "watch" ? "slow" : action;
  } else if (trafficLeg.firstHeavyCongestionFraction != null) {
    id = "traffic-delay";
    alongM = totalMeters * trafficLeg.firstHeavyCongestionFraction;
    startM = alongM;
    endM = alongM;
    aheadM = Math.max(0, alongM - userAlongM);
    roadEffect = "Congestion ahead — ease off and add following distance.";
    action = action === "watch" ? "slow" : action;
  } else {
    return null;
  }

  const eta =
    totalMeters > 0 && opts.planEtaMinutes != null && Number.isFinite(opts.planEtaMinutes)
      ? Math.max(0, opts.planEtaMinutes * (aheadM / totalMeters))
      : null;

  return {
    id,
    category: trafficLeg.hasClosure ? "closure" : "traffic",
    severity: sev,
    confidence,
    source: "mapboxTraffic",
    lngLat: alongToLngLat(geometry, alongM, opts.userLngLat),
    alongMeters: alongM,
    startMeters: startM,
    endMeters: endM,
    distanceAheadMeters: aheadM,
    etaAheadMinutes: eta,
    driverHeadline: story.advisoryHeadline,
    driverAction: action,
    roadEffect,
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
  /** Precomputed route length — avoids re-walking huge polylines every GPS tick. */
  totalMeters?: number;
  slice: RouteSituationSlice | undefined;
  trafficForRoute: ScoredRoute | undefined;
  trafficLeg: MapboxTrafficLeg | null;
  /** Forecast / corridor weather text for the radar impact's detail line. */
  corridorWeatherDetail?: string;
  /** NWS bands along this route polyline. */
  nwsBands: NwsBandForImpact[];
  /** NWS alerts overlapping the corridor — used to pick a real event title for each band. */
  nwsAlerts: NormalizedWeatherAlert[];
  /** RainViewer mosaic samples along the route (same tiles as the map overlay). */
  radarMosaicSamples?: RadarMosaicSample[];
};

function buildRadarMosaicSegmentImpacts(opts: {
  geometry: LngLat[] | undefined;
  samples: RadarMosaicSample[];
  forecastHeadline: string;
  corridorWeatherDetail: string;
  userAlongM: number;
  planEtaMinutes: number | null | undefined;
  totalMeters: number;
  userLngLat: LngLat | null;
  hasNwsBand: boolean;
}): RouteImpact[] {
  const { samples, totalMeters, hasNwsBand } = opts;
  if (!samples.length || totalMeters <= 0) return [];
  const bands = mergeRadarMosaicBands(samples);
  const out: RouteImpact[] = [];
  for (let i = 0; i < bands.length; i++) {
    const band = bands[i]!;
    const impact = buildRadarImpact({
      geometry: opts.geometry,
      radarIntensity: band.maxIntensity,
      forecastHeadline: opts.forecastHeadline,
      corridorWeatherDetail: opts.corridorWeatherDetail,
      userAlongM: opts.userAlongM,
      planEtaMinutes: opts.planEtaMinutes,
      totalMeters,
      userLngLat: opts.userLngLat,
      hasNwsBand,
      startFraction: band.startT,
      endFraction: band.endT,
      idSuffix: `band-${i}`,
    });
    if (impact) out.push(impact);
  }
  return out;
}

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
    radarMosaicSamples = [],
  } = opts;

  const totalMeters =
    opts.totalMeters != null && opts.totalMeters > 0
      ? opts.totalMeters
      : geometry?.length
        ? polylineLengthMeters(geometry)
        : 0;
  const mosaicMax =
    radarMosaicSamples.length > 0
      ? Math.max(...radarMosaicSamples.map((s) => s.intensity))
      : 0;
  const radarIntensity = Math.max(slice?.radarIntensity ?? 0, mosaicMax);
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

  const hasNwsBand = nwsImpacts.length > 0;
  const mosaicSegments = buildRadarMosaicSegmentImpacts({
    geometry,
    samples: radarMosaicSamples,
    forecastHeadline,
    corridorWeatherDetail,
    userAlongM,
    planEtaMinutes,
    totalMeters,
    userLngLat,
    hasNwsBand,
  });
  if (mosaicSegments.length > 0) {
    list.push(...mosaicSegments);
  } else {
    const radarImpact = buildRadarImpact({
      geometry,
      radarIntensity,
      forecastHeadline,
      corridorWeatherDetail,
      userAlongM,
      planEtaMinutes,
      totalMeters,
      userLngLat,
      hasNwsBand,
    });
    if (radarImpact) list.push(radarImpact);
  }

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
