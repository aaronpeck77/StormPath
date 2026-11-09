/**
 * Correlate live Mapbox per-segment congestion with DOT/WZDx band impacts.
 *
 * `trafficLeg.congestionNumeric` is one value per segment of the *remaining*
 * route polyline fetched while navigating (origin→dest when barely started).
 * A work zone's [startMeters, endMeters] band maps to a fraction range of that
 * fetched span, so we can say "backed up ~2 mi through the zone" and promote a
 * backed-up construction alert into a bypass candidate.
 */
import type { MapboxTrafficLeg } from "../services/mapboxDirectionsTraffic";
import { TRAFFIC_REMAINING_SLICE_MIN_ALONG_M } from "./routeRemaining";
import { METERS_PER_MILE } from "./constants";
import { DOT_SEVERITY_NUMERIC } from "./dotImpacts";
import type { RouteImpact } from "./routeImpacts";

/** congestion_numeric bands — aligned with summarizeCongestion / near-stop thresholds. */
const SLOW_MIN = 55;
const HEAVY_MIN = 70;
const SEVERE_MIN = 88;
/** Ignore slivers — a single congested sample on a tiny overlap is noise. */
const MIN_BACKUP_METERS = 200;

export type BandTrafficBackup = {
  /** Approx meters of congested (>=60) road inside the band. */
  backedUpMeters: number;
  /** Worst congestion_numeric sample inside the band (0..100). */
  worst: number;
  level: "slow" | "heavy" | "severe";
};

/**
 * Congestion profile inside one along-route band. Returns null when the leg has
 * no per-segment samples or the band doesn't overlap the fetched span.
 */
export function bandTrafficBackup(
  leg: MapboxTrafficLeg | null | undefined,
  bandStartM: number,
  bandEndM: number,
  userAlongM: number,
  totalM: number
): BandTrafficBackup | null {
  const segs = leg?.congestionNumeric;
  if (!segs?.length || totalM <= 0) return null;

  /* Mirror geometryForRemainingTrafficFetch: mid-trip the fetch starts at the
   * puck, so band meters must be rebased onto the remaining span. */
  const sliced =
    Number.isFinite(userAlongM) &&
    userAlongM > TRAFFIC_REMAINING_SLICE_MIN_ALONG_M &&
    userAlongM < totalM - TRAFFIC_REMAINING_SLICE_MIN_ALONG_M;
  const baseM = sliced ? Math.max(0, userAlongM) : 0;
  const spanM = totalM - baseM;
  if (spanM <= 0) return null;

  const f0 = Math.max(0, Math.min(1, (bandStartM - baseM) / spanM));
  const f1 = Math.max(0, Math.min(1, (bandEndM - baseM) / spanM));
  if (f1 <= f0) return null;

  const n = segs.length;
  const i0 = Math.max(0, Math.floor(f0 * n));
  const i1 = Math.min(n, Math.max(i0 + 1, Math.ceil(f1 * n)));

  const segM = spanM / n;
  let backedUpMeters = 0;
  let worst = 0;
  for (let i = i0; i < i1; i++) {
    const c = segs[i];
    if (typeof c !== "number" || !Number.isFinite(c)) continue;
    if (c > worst) worst = c;
    if (c >= 60) backedUpMeters += segM;
  }
  if (backedUpMeters < MIN_BACKUP_METERS || worst < SLOW_MIN) return null;

  /* A detected near-stop point inside the band is the strongest backup signal. */
  const nearStop = leg?.nearStopFraction;
  const severe =
    worst >= SEVERE_MIN || (nearStop != null && nearStop >= f0 && nearStop <= f1);
  return {
    backedUpMeters,
    worst,
    level: severe ? "severe" : worst >= HEAVY_MIN ? "heavy" : "slow",
  };
}

function fmtBackupMi(meters: number): string {
  const mi = meters / METERS_PER_MILE;
  return mi < 10 ? mi.toFixed(1) : `${Math.round(mi)}`;
}

function backupPhrase(b: BandTrafficBackup): string {
  const mi = fmtBackupMi(b.backedUpMeters);
  if (b.level === "severe") return `stop-and-go for ~${mi} mi`;
  if (b.level === "heavy") return `heavy congestion for ~${mi} mi`;
  return `slow traffic for ~${mi} mi`;
}

/**
 * Annotate dot511 impacts in place with live backup estimates. A severe backup
 * promotes the work zone to serious + rerouteAvailable so the bypass offer and
 * hazard-band paint pick it up; heavy/slow add detail text only.
 */
export function applyDotTrafficBackup(
  impacts: RouteImpact[],
  leg: MapboxTrafficLeg | null | undefined,
  userAlongM: number,
  totalM: number
): void {
  if (!leg?.congestionNumeric?.length || totalM <= 0) return;
  for (const imp of impacts) {
    if (imp.source !== "dot511") continue;
    const b = bandTrafficBackup(leg, imp.startMeters, imp.endMeters, userAlongM, totalM);
    if (!b) continue;
    const phrase = backupPhrase(b);
    const note = `Live traffic shows ${phrase} through the zone.`;
    if (!imp.detail.includes("Live traffic shows")) {
      imp.detail = `${imp.detail} ${note}`.trim();
    }
    if (b.level === "severe") {
      imp.roadEffect = `${imp.roadEffect} Backed up ~${fmtBackupMi(b.backedUpMeters)} mi — a bypass may save real time.`.trim();
      if (imp.severity === "info" || imp.severity === "caution") {
        imp.severity = "serious";
        imp.numericSeverity = DOT_SEVERITY_NUMERIC.serious;
      }
      if (imp.driverAction === "watch" || imp.driverAction === "slow") {
        imp.driverAction = "rerouteAvailable";
      }
    } else if (b.level === "heavy") {
      imp.roadEffect = `${imp.roadEffect} Traffic backed up ~${fmtBackupMi(b.backedUpMeters)} mi.`.trim();
    }
  }
}
