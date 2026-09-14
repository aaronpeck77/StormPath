/**
 * Plain-English Timing ticker lines when live map weather and corridor ETA weather disagree.
 * Advisory bar only — no map chrome.
 */

import { RADAR_SOFT_THRESHOLD } from "./constants";
import { radarDisplayIntensity } from "./radarReflectivityScale";
import type { RouteImpact } from "./routeImpacts";

export type CorridorTimingExplainTone = "info" | "warn";

export type CorridorTimingExplainLine = {
  badge: "Timing";
  text: string;
  tone: CorridorTimingExplainTone;
};

export type CorridorTimingOutlookStep = {
  fraction: number;
  shortLabel: string;
  conditions: string;
  precipHint: number;
  precipPct: number | null;
  precipIntensityMmh?: number;
  etaLabel: string | null;
};

export type CorridorTimingRadarSample = {
  t: number;
  intensity: number;
};

/** Compact ETA for ticker (~45 min / ~2h / ~1h 20m). */
export function compactTimingEta(min: number | null | undefined): string | null {
  if (min == null || !Number.isFinite(min) || min < 0) return null;
  if (min < 1) return "now";
  if (min < 60) return `~${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m > 0 ? `~${h}h ${m}m` : `~${h}h`;
}

function stormyConditions(conditions: string): boolean {
  return /thunder|tstm|t-?storm|\bstorms?\b|severe|\bhail\b/i.test(conditions);
}

/** 0–1 precip severity from an outlook stop (ETA-sampled). */
export function outlookPrecipScore(step: CorridorTimingOutlookStep): number {
  if (stormyConditions(step.conditions)) return 1;
  const hint = Number.isFinite(step.precipHint) ? step.precipHint : 0;
  const pct = Math.max(0, Math.min(1, (step.precipPct ?? 0) / 100));
  const mm = step.precipIntensityMmh ?? 0;
  const fromMm = mm >= 1 ? 0.75 : mm >= 0.3 ? 0.45 : mm > 0 ? 0.25 : 0;
  return Math.max(hint, pct, fromMm);
}

function liveRadarAheadMax(
  samples: CorridorTimingRadarSample[],
  userAlongT: number
): number {
  const aheadT = Math.min(0.999, Math.max(0, userAlongT) + 0.015);
  const ahead = samples.filter((s) => Number.isFinite(s.t) && s.t >= aheadT);
  if (!ahead.length) return 0;
  let max = 0;
  for (const s of ahead) {
    const d = radarDisplayIntensity(s.intensity);
    if (d > max) max = d;
  }
  return max;
}

/**
 * NWS (etc.) suppressed because it ends before arrival — Timing phrasing for the ticker.
 */
export function mayPassTimingLine(impact: RouteImpact): string | null {
  if (impact.arrivalVerdict !== "may_pass") return null;
  if (impact.source === "mapboxTraffic") return null;
  const verdict = impact.arrivalVerdictLine?.trim() ?? "";
  if (!verdict) return null;
  if (!/over before|already behind/i.test(verdict)) return null;

  const title = (impact.driverHeadline || "Weather alert").replace(/\s+/g, " ").trim();
  const eta = compactTimingEta(impact.etaAheadMinutes);

  if (/already behind/i.test(verdict)) {
    return `${title} — already behind you.`;
  }
  return eta
    ? `${title} on the map — likely over before you reach it (${eta}).`
    : `${title} on the map — likely over before you reach it.`;
}

export function buildCorridorTimingExplainLines(input: {
  hasActiveRoute: boolean;
  userAlongT: number;
  remainingEtaMinutes: number | null;
  radarSamples: CorridorTimingRadarSample[];
  outlookSteps: CorridorTimingOutlookStep[];
  routeImpacts?: RouteImpact[] | null;
}): CorridorTimingExplainLine[] {
  if (!input.hasActiveRoute) return [];

  const lines: CorridorTimingExplainLine[] = [];
  const liveMax = liveRadarAheadMax(input.radarSamples, input.userAlongT);
  const aheadT = Math.min(0.999, Math.max(0, input.userAlongT) + 0.015);
  const outlookAhead = input.outlookSteps.filter(
    (s) => Number.isFinite(s.fraction) && s.fraction >= aheadT
  );

  let worst: CorridorTimingOutlookStep | null = null;
  let worstScore = 0;
  let scoreSum = 0;
  for (const step of outlookAhead) {
    const score = outlookPrecipScore(step);
    scoreSum += score;
    if (score > worstScore) {
      worstScore = score;
      worst = step;
    }
  }
  const avgForecast = outlookAhead.length ? scoreSum / outlookAhead.length : 0;
  const tripEta = compactTimingEta(input.remainingEtaMinutes);

  // Live storm ahead on mosaic, corridor forecast calm at ETA.
  if (liveMax >= RADAR_SOFT_THRESHOLD && outlookAhead.length >= 1 && worstScore < 0.35 && avgForecast < 0.3) {
    const when = tripEta ? ` by your ETA (${tripEta})` : " by the time you get there";
    lines.push({
      badge: "Timing",
      text: `Storm on the map now — forecast clear${when}.`,
      tone: "info",
    });
  }

  // Map calm ahead, ETA-sampled outlook stormy.
  if (liveMax < RADAR_SOFT_THRESHOLD && worst && worstScore >= 0.45) {
    const where = (worst.shortLabel || "ahead").trim() || "ahead";
    const whenRaw = (worst.etaLabel || tripEta || "").replace(/^~/, "").trim();
    const when = whenRaw ? ` (~${whenRaw})` : "";
    lines.push({
      badge: "Timing",
      text: stormyConditions(worst.conditions)
        ? `Clear on the map now — thunderstorms likely near ${where}${when}.`
        : `Clear on the map now — rain likely near ${where}${when}.`,
      tone: "warn",
    });
  }

  // NWS may_pass when we didn't already explain clear-by-ETA from radar/forecast.
  const alreadyExplainedClear = lines.some((l) => /forecast clear/i.test(l.text));
  if (!alreadyExplainedClear && input.routeImpacts?.length) {
    for (const impact of input.routeImpacts) {
      const text = mayPassTimingLine(impact);
      if (!text) continue;
      lines.push({ badge: "Timing", text, tone: "info" });
      break;
    }
  }

  return lines.slice(0, 2);
}
