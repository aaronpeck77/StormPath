import { arrivalTimeMsAtAlongMeters } from "../../nav/routeForecastTimeline";
import { segmentCountForRoute } from "../../forecast/routeSunEvents";
import type { LngLat } from "../../nav/types";
import { RADAR_REROUTE_THRESHOLD, RADAR_SOFT_THRESHOLD } from "../../nav/constants";
import {
  driverSuggestionsForKind,
  eventLine,
  pickAdvisoryLine,
  verdictForEvent,
} from "./driverOptions";
import { denseRadarFractions, radarIntensityAtFraction, type RadarSample } from "./interpolateRadar";
import type { StormCorridorEvent, StormCorridorIntersectResult } from "./types";

type ThresholdBand = { start: number; end: number; level: "light" | "heavy" };

function estimateFullRouteEtaMinutes(totalMeters: number): number {
  if (totalMeters <= 0) return 60;
  return (totalMeters / 1609.344 / 55) * 60;
}

function resolvePlanEtaMinutes(opts: {
  totalMeters: number;
  userAlongMeters: number;
  planEtaMinutes: number | null;
  driveEtaMinutes?: number | null;
}): number {
  const { totalMeters, userAlongMeters, planEtaMinutes, driveEtaMinutes = null } = opts;
  if (planEtaMinutes != null && Number.isFinite(planEtaMinutes)) return planEtaMinutes;
  if (
    driveEtaMinutes != null &&
    Number.isFinite(driveEtaMinutes) &&
    totalMeters > userAlongMeters
  ) {
    return driveEtaMinutes * (totalMeters / Math.max(1, totalMeters - userAlongMeters));
  }
  return estimateFullRouteEtaMinutes(totalMeters);
}

function etaMinutesAtFraction(
  fraction: number,
  totalMeters: number,
  userAlongMeters: number,
  planEtaMinutes: number,
  driveEtaMinutes: number | null,
  nowMs: number
): number | null {
  const arrivalMs = arrivalTimeMsAtAlongMeters(fraction * totalMeters, {
    totalMeters,
    userAlongMeters,
    planEtaMinutes,
    driveEtaMinutes,
    nowMs,
  });
  if (arrivalMs == null) return null;
  return Math.max(0, (arrivalMs - nowMs) / 60_000);
}

function levelAtIntensity(intensity: number): "clear" | "light" | "heavy" {
  if (intensity >= RADAR_REROUTE_THRESHOLD) return "heavy";
  if (intensity >= RADAR_SOFT_THRESHOLD) return "light";
  return "clear";
}

function mergeLevelBands(samples: { fraction: number; level: "clear" | "light" | "heavy" }[]): ThresholdBand[] {
  const bands: ThresholdBand[] = [];
  for (const s of samples) {
    if (s.level === "clear") continue;
    const prev = bands[bands.length - 1];
    if (prev && prev.level === s.level && Math.abs(prev.end - s.fraction) < 0.04) {
      prev.end = s.fraction;
    } else {
      bands.push({ start: s.fraction, end: s.fraction, level: s.level });
    }
  }
  return bands.filter((b) => b.end >= b.start);
}

function findCrossings(
  fractions: number[],
  intensities: number[],
  threshold: number,
  enterKind: StormCorridorEvent["kind"],
  exitKind: StormCorridorEvent["kind"]
): { fraction: number; kind: StormCorridorEvent["kind"]; intensity: number }[] {
  const out: { fraction: number; kind: StormCorridorEvent["kind"]; intensity: number }[] = [];
  for (let i = 1; i < fractions.length; i++) {
    const prevI = intensities[i - 1]!;
    const currI = intensities[i]!;
    const prevAbove = prevI >= threshold;
    const currAbove = currI >= threshold;
    if (!prevAbove && currAbove) {
      out.push({ fraction: fractions[i]!, kind: enterKind, intensity: currI });
    } else if (prevAbove && !currAbove) {
      out.push({ fraction: fractions[i]!, kind: exitKind, intensity: prevI });
    }
  }
  return out;
}

/**
 * Where along the route your ETA meets moving radar echo (from along-route samples).
 * Samples are already time-aligned when the radar hook uses ETA frames (trips > ~5 min).
 */
export function buildStormCorridorIntersect(opts: {
  geometry: LngLat[];
  totalMeters: number;
  userAlongMeters: number;
  planEtaMinutes: number | null;
  driveEtaMinutes?: number | null;
  nowMs?: number;
  radarSamples: RadarSample[];
}): StormCorridorIntersectResult | null {
  const {
    geometry,
    totalMeters,
    userAlongMeters,
    driveEtaMinutes = null,
    nowMs = Date.now(),
    radarSamples,
  } = opts;

  if (geometry.length < 2 || totalMeters <= 0 || radarSamples.length < 3) {
    return null;
  }

  const resolvedPlanEta = resolvePlanEtaMinutes(opts);
  const userAlongFraction = Math.max(0, Math.min(1, userAlongMeters / totalMeters));

  const fractions =
    totalMeters > 400_000
      ? Array.from({ length: segmentCountForRoute(totalMeters) }, (_, i) => (i + 0.5) / segmentCountForRoute(totalMeters))
      : denseRadarFractions(radarSamples);

  const intensities = fractions.map((f) => radarIntensityAtFraction(radarSamples, f));
  const levelSamples = intensities.map((intensity, i) => ({
    fraction: fractions[i]!,
    level: levelAtIntensity(intensity),
  }));

  const bands = mergeLevelBands(levelSamples);

  const rawCrossings = [
    ...findCrossings(fractions, intensities, RADAR_SOFT_THRESHOLD, "enter_light", "exit_light"),
    ...findCrossings(fractions, intensities, RADAR_REROUTE_THRESHOLD, "enter_heavy", "exit_heavy"),
  ].sort((a, b) => a.fraction - b.fraction);

  const events: StormCorridorEvent[] = rawCrossings.map((c) => {
    const etaMinutes = etaMinutesAtFraction(
      c.fraction,
      totalMeters,
      userAlongMeters,
      resolvedPlanEta,
      driveEtaMinutes,
      nowMs
    );
    const verdict = verdictForEvent(c.kind, etaMinutes, userAlongFraction, c.fraction);
    return {
      fraction: c.fraction,
      alongMeters: c.fraction * totalMeters,
      kind: c.kind,
      intensity: c.intensity,
      etaMinutes,
      verdict,
      suggestions: driverSuggestionsForKind(c.kind),
      line: eventLine(c.kind, etaMinutes, c.intensity),
    };
  });

  if (!events.length && !bands.length) return null;

  return {
    events,
    bands,
    advisoryLine: pickAdvisoryLine(events),
  };
}
