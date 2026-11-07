/**
 * Departure-time optimization — pure model.
 *
 * Scores "what if we left later" across the hourly forecast window kept by the
 * departure scan (see services/departureScanTypes.ts). Weather-only by design:
 * traffic-by-departure-time isn't honestly available, so this never pretends
 * to factor it in.
 */

import {
  DEPARTURE_SCAN_MAX_SHIFT_MIN,
  DEPARTURE_SCAN_STEP_MIN,
  type DepartureScanHour,
  type DepartureScanLocation,
  type DepartureScanWaypoint,
} from "../services/departureScanTypes";
import { weatherCodeSeverity } from "../services/tomorrowIo";

export type DepartureCandidate = {
  /** Minutes after "now" the driver would leave. */
  shiftMin: number;
  /** Combined exposure score 0–1 (lower = calmer corridor). */
  score: number;
  /** Worst single waypoint exposure. */
  maxWaypointScore: number;
  /** Mean waypoint exposure. */
  meanWaypointScore: number;
  /** Fraction of waypoints with forecast coverage at this shift (0–1). */
  coverage: number;
};

export type DepartureRecommendationKind =
  | "leave_now"
  | "wait"
  | "anytime"
  | "rough_anyway";

export type DepartureRecommendation = {
  kind: DepartureRecommendationKind;
  /** e.g. "Consider leaving around 7:00 AM" */
  headline: string;
  /** One-line why. */
  detail: string;
  /** Best shift in minutes-from-now (null for anytime/leave_now defaults). */
  shiftMin: number;
  /** Absolute offset (min-from-now) when the driver would arrive at shiftMin. */
  arriveOffsetMin: number;
};

export type DepartureAnalysis = {
  status: "ready" | "partial" | "unavailable";
  candidates: DepartureCandidate[];
  recommendation: DepartureRecommendation | null;
  /** Contiguous corridor-badness window in minutes-from-now, when one exists. */
  stormWindow: { startMin: number; endMin: number } | null;
  /** Furthest forecast offset available across locations (minutes). */
  coverageMin: number;
};

/* ── Scoring ─────────────────────────────────────────────────────────────── */

/** Below this a waypoint hour counts as workable; above STORM it counts as bad. */
const SCORE_CLEAR = 0.3;
const SCORE_STORM = 0.55;
/** A candidate needs this much waypoint coverage to be trusted. */
const MIN_CANDIDATE_COVERAGE = 0.6;
/** Nearest-hour match tolerance — hourly data shouldn't be stretched further. */
const HOUR_MATCH_TOLERANCE_MIN = 90;

function scanHourScore(h: DepartureScanHour): number {
  const sev = weatherCodeSeverity(h.weatherCode, h.precipIntensityMmh, h.windGustMph);
  const sevScore =
    sev === "avoid" ? 1 : sev === "serious" ? 0.72 : sev === "caution" ? 0.45 : 0;
  const precipScore =
    Math.min(1, h.precipIntensityMmh / 8) * 0.9 + Math.min(1, h.precipProbability) * 0.35;
  const windScore =
    h.windGustMph >= 45 ? 0.65 : h.windGustMph >= 35 ? 0.45 : h.windGustMph >= 25 ? 0.25 : 0;
  return Math.min(1, Math.max(sevScore, precipScore, windScore));
}

function nearestScanHour(
  hours: DepartureScanHour[],
  offsetMin: number
): DepartureScanHour | null {
  if (!hours.length) return null;
  let best = hours[0]!;
  let bestD = Math.abs(best.offsetMin - offsetMin);
  for (const h of hours) {
    const d = Math.abs(h.offsetMin - offsetMin);
    if (d < bestD) {
      bestD = d;
      best = h;
    }
  }
  return bestD <= HOUR_MATCH_TOLERANCE_MIN ? best : null;
}

function nearestLocation(
  wp: { lat: number; lng: number },
  locations: DepartureScanLocation[]
): DepartureScanLocation | null {
  if (!locations.length) return null;
  let best = locations[0]!;
  let bestD = Number.POSITIVE_INFINITY;
  for (const loc of locations) {
    const dLat = wp.lat - loc.lat;
    const dLng = wp.lng - loc.lng;
    const d = dLat * dLat + dLng * dLng;
    if (d < bestD) {
      bestD = d;
      best = loc;
    }
  }
  return best;
}

/** Hour score for one waypoint at absolute offset `offsetMin` from now. */
function waypointScoreAt(
  wp: DepartureScanWaypoint,
  locations: DepartureScanLocation[],
  offsetMin: number
): number | null {
  const loc = nearestLocation(wp, locations);
  if (!loc) return null;
  const h = nearestScanHour(loc.hours, offsetMin);
  return h ? scanHourScore(h) : null;
}

function scoreShift(
  waypoints: DepartureScanWaypoint[],
  locations: DepartureScanLocation[],
  shiftMin: number
): Omit<DepartureCandidate, "shiftMin"> | null {
  const scores: number[] = [];
  for (const wp of waypoints) {
    const s = waypointScoreAt(wp, locations, shiftMin + wp.travelMin);
    if (s != null) scores.push(s);
  }
  if (!scores.length) return null;
  const max = Math.max(...scores);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  return {
    score: 0.65 * max + 0.35 * mean,
    maxWaypointScore: max,
    meanWaypointScore: mean,
    coverage: scores.length / waypoints.length,
  };
}

/**
 * Corridor badness by absolute hour: worst waypoint exposure at each offset.
 * Answers "when is bad weather sitting over the route" independent of departure.
 */
function corridorBadnessByHour(
  waypoints: DepartureScanWaypoint[],
  locations: DepartureScanLocation[],
  coverageMin: number
): { offsetMin: number; score: number }[] {
  const out: { offsetMin: number; score: number }[] = [];
  for (let h = 0; h <= coverageMin; h += 60) {
    let max = 0;
    let any = false;
    for (const wp of waypoints) {
      const s = waypointScoreAt(wp, locations, h);
      if (s == null) continue;
      any = true;
      if (s > max) max = s;
    }
    if (any) out.push({ offsetMin: h, score: max });
  }
  return out;
}

function findStormWindow(
  badness: { offsetMin: number; score: number }[]
): { startMin: number; endMin: number } | null {
  const bad = badness.filter((b) => b.score >= SCORE_STORM);
  if (!bad.length) return null;
  /* Cluster bad hours allowing ≤2 h gaps (hourly granularity makes strict
   * adjacency too brittle), then report the worst cluster. */
  const clusters: { startMin: number; endMin: number; peak: number; sum: number; n: number }[] = [];
  let cur: (typeof clusters)[number] | null = null;
  for (const b of bad) {
    if (cur && b.offsetMin - cur.endMin <= 120) {
      cur.endMin = b.offsetMin;
      cur.peak = Math.max(cur.peak, b.score);
      cur.sum += b.score;
      cur.n += 1;
    } else {
      cur = { startMin: b.offsetMin, endMin: b.offsetMin, peak: b.score, sum: b.score, n: 1 };
      clusters.push(cur);
    }
  }
  clusters.sort((a, b) => b.peak - a.peak || b.sum / b.n - a.sum / a.n);
  const best = clusters[0]!;
  return { startMin: best.startMin, endMin: best.endMin };
}

/* ── Clock helpers ───────────────────────────────────────────────────────── */

export function formatOffsetClock(offsetMin: number, nowMs: number): string {
  const d = new Date(nowMs + offsetMin * 60_000);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function windowClockLabel(
  window: { startMin: number; endMin: number } | null,
  nowMs: number
): string | null {
  if (!window) return null;
  const start = formatOffsetClock(window.startMin, nowMs);
  const end = formatOffsetClock(window.endMin + 60, nowMs);
  return `${start}–${end}`;
}

/* ── Analysis ────────────────────────────────────────────────────────────── */

export function analyzeDepartureTiming(input: {
  locations: DepartureScanLocation[];
  waypoints: DepartureScanWaypoint[];
  tripEtaMin: number;
  nowMs?: number;
}): DepartureAnalysis {
  const { locations, waypoints } = input;
  const nowMs = input.nowMs ?? Date.now();
  const tripEtaMin = Math.max(1, input.tripEtaMin);

  const usable = locations.filter((l) => l.hours.length > 0);
  if (!usable.length || !waypoints.length) {
    return {
      status: "unavailable",
      candidates: [],
      recommendation: null,
      stormWindow: null,
      coverageMin: 0,
    };
  }

  const coverageMin = Math.min(
    ...usable.map((l) => Math.max(...l.hours.map((h) => h.offsetMin)))
  );

  const candidates: DepartureCandidate[] = [];
  let fullWindowCovered = true;
  for (let shift = 0; shift <= DEPARTURE_SCAN_MAX_SHIFT_MIN; shift += DEPARTURE_SCAN_STEP_MIN) {
    const scored = scoreShift(waypoints, usable, shift);
    if (!scored || scored.coverage < MIN_CANDIDATE_COVERAGE) {
      if (shift === 0) {
        /* Can't even score leaving now — nothing trustworthy to say. */
        return {
          status: "unavailable",
          candidates: [],
          recommendation: null,
          stormWindow: null,
          coverageMin,
        };
      }
      fullWindowCovered = false;
      continue;
    }
    candidates.push({ shiftMin: shift, ...scored });
  }

  if (!candidates.length) {
    return {
      status: "unavailable",
      candidates: [],
      recommendation: null,
      stormWindow: null,
      coverageMin,
    };
  }

  const maxScoredShift = Math.max(...candidates.map((c) => c.shiftMin));
  const partial = !fullWindowCovered || maxScoredShift < DEPARTURE_SCAN_MAX_SHIFT_MIN - DEPARTURE_SCAN_STEP_MIN;

  const badness = corridorBadnessByHour(waypoints, usable, coverageMin);
  const stormWindow = findStormWindow(badness);
  const windowLabel = windowClockLabel(stormWindow, nowMs);

  const baseline = candidates[0]!; // shift 0 = leave now
  const best = candidates.reduce((a, b) => (b.score < a.score ? b : a));
  const allClear = candidates.every((c) => c.score < SCORE_CLEAR);

  let recommendation: DepartureRecommendation;
  if (allClear) {
    recommendation = {
      kind: "anytime",
      headline: "Conditions look workable whenever you leave",
      detail: windowLabel
        ? `Corridor stays below storm level through the forecast window (worst stretch ~${windowLabel}).`
        : "No significant weather on the corridor through the forecast window.",
      shiftMin: 0,
      arriveOffsetMin: tripEtaMin,
    };
  } else if (best.score >= SCORE_STORM && best.score >= baseline.score * 0.9) {
    recommendation = {
      kind: "rough_anyway",
      headline: `Stormy whenever you go — least-bad window ~${formatOffsetClock(best.shiftMin, nowMs)}`,
      detail: windowLabel
        ? `Heaviest corridor weather ~${windowLabel}; this departure threads the calmest part.`
        : "Every departure window carries meaningful storm exposure — pick by schedule, not weather.",
      shiftMin: best.shiftMin,
      arriveOffsetMin: best.shiftMin + tripEtaMin,
    };
  } else if (best.shiftMin > 0 && baseline.score - best.score >= 0.15) {
    const improvement = baseline.score > 0 ? Math.round(((baseline.score - best.score) / baseline.score) * 100) : 0;
    recommendation = {
      kind: "wait",
      headline: `Consider leaving around ${formatOffsetClock(best.shiftMin, nowMs)}`,
      detail: [
        windowLabel ? `Heaviest corridor weather ~${windowLabel}.` : "A later window is meaningfully calmer.",
        improvement > 0 ? `~${improvement}% less storm exposure than leaving now.` : "",
      ]
        .filter(Boolean)
        .join(" "),
      shiftMin: best.shiftMin,
      arriveOffsetMin: best.shiftMin + tripEtaMin,
    };
  } else {
    recommendation = {
      kind: "leave_now",
      headline: "Leave now — about the best window",
      detail: windowLabel
        ? `Heaviest corridor weather ~${windowLabel}; leaving now stays ahead of it.`
        : "No clearly better departure window in the forecast.",
      shiftMin: 0,
      arriveOffsetMin: tripEtaMin,
    };
  }

  return {
    status: partial ? "partial" : "ready",
    candidates,
    recommendation,
    stormWindow,
    coverageMin,
  };
}
