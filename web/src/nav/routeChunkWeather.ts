import { chordFractionToAlongMeters } from "./routeGeometry";
import type { LngLat } from "./types";

export type WxSample = { t: number; headline: string; precipHint: number };

/** Strip redundant cloud % from OpenWeather one-liners for glanceable UI. */
export function compactWxHeadline(headline: string): string {
  return headline
    .replace(/;\s*clouds\s*\d+%/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

const SPLIT_ROUTE_FORECAST = /\s*(?:→|\u2192)\s*/;

/** Rich route forecast: `Start: … → Quarter: … → …` (from {@link weatherForecastAlongRoute}). */
export function forecastSlicesForChunkFraction(
  forecastHeadline: string,
  fracLo: number,
  fracHi: number
): string[] {
  const h = forecastHeadline.trim();
  if (!h || !SPLIT_ROUTE_FORECAST.test(h)) return [];

  const parts = h.split(SPLIT_ROUTE_FORECAST).map((s) => s.trim()).filter(Boolean);
  const labeled: { f: number; text: string }[] = [];

  for (const p of parts) {
    let f: number | null = null;
    if (/^Start\b/i.test(p)) f = 0;
    else if (/^Quarter\b/i.test(p)) f = 0.25;
    else if (/^Midway\b/i.test(p)) f = 0.5;
    else if (/^3\/4/i.test(p)) f = 0.75;
    else if (/^Destination\b/i.test(p)) f = 1;
    if (f != null) labeled.push({ f, text: compactWxHeadline(p) });
  }

  if (labeled.length === 0) return [];

  const mid = (fracLo + fracHi) / 2;
  const margin = 0.14;
  const hits = labeled.filter((x) => x.f >= fracLo - margin && x.f <= fracHi + margin);
  if (hits.length > 0) return hits.map((x) => x.text);

  const nearest = labeled.reduce((a, b) => (Math.abs(a.f - mid) <= Math.abs(b.f - mid) ? a : b));
  return [nearest.text];
}

/** Text after the `Destination:` label in a full-route forecast headline, if present. */
export function extractDestinationForecastLine(forecastHeadline: string): string {
  const h = forecastHeadline.trim();
  if (!h || !SPLIT_ROUTE_FORECAST.test(h)) return "";
  const parts = h.split(SPLIT_ROUTE_FORECAST).map((s) => s.trim()).filter(Boolean);
  for (const p of parts) {
    if (/^Destination\b/i.test(p)) return compactWxHeadline(p) || p;
  }
  return "";
}

/**
 * When &lt; ~100 mi remain, one glanceable block: conditions along the remainder vs at arrival.
 */
export function buildShortFinalStretchSummary(
  forecastHeadline: string,
  weatherSamples: WxSample[] | undefined,
  geometry: LngLat[],
  totalM: number,
  userAlongM: number
): { onTheWay: string; atDest: string; wxTooltipLines: string[] } {
  const fc = forecastHeadline.trim();
  const samples = weatherSamples ?? [];
  const userFrac = Math.min(0.999, Math.max(0, userAlongM / totalM));
  /* Keep “on the way” mostly ahead of the puck; destination line is separate. */
  const onWayFracHi = Math.min(0.92, 1 - 1e-6);
  let onWaySlices =
    fc && userFrac < onWayFracHi ? forecastSlicesForChunkFraction(fc, userFrac, onWayFracHi) : [];
  const destFromTimeline = extractDestinationForecastLine(fc);
  if (destFromTimeline && onWaySlices.some((s) => /^Destination\b/i.test(s))) {
    onWaySlices = onWaySlices.filter((s) => !/^Destination\b/i.test(s));
  }

  const segSamples = samplesOverlappingChunk(samples, geometry, userAlongM, totalM, totalM);
  let onWay = "";
  if (onWaySlices.length > 0) {
    onWay = onWaySlices.map((s) => compactWxHeadline(s)).join(" · ");
  } else if (segSamples.length > 0) {
    onWay = segSamples.map((s) => compactWxHeadline(s.headline)).filter(Boolean).join(" · ");
  } else {
    const mid = (userAlongM + totalM) / 2;
    let best = samples[0];
    let bestD = Infinity;
    for (const s of samples) {
      const am = chordFractionToAlongMeters(geometry, s.t);
      const d = Math.abs(am - mid);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    onWay = best ? compactWxHeadline(best.headline) : "No forecast slice for this stretch";
  }

  let atDest = destFromTimeline;
  if (!atDest) {
    const endSamples = samplesOverlappingChunk(samples, geometry, totalM * 0.92, totalM, totalM);
    if (endSamples.length > 0) {
      atDest = compactWxHeadline(endSamples[endSamples.length - 1]!.headline);
    } else {
      const tail = forecastSlicesForChunkFraction(fc, 0.88, 1);
      atDest = tail.length ? tail.map((s) => compactWxHeadline(s)).join(" · ") : onWay;
    }
  }

  const wxTooltipLines = [onWay, atDest].filter(Boolean);
  return { onTheWay: onWay, atDest, wxTooltipLines };
}

/** Samples whose distance along the line falls in [lo, hi] (with margin). */
export function samplesOverlappingChunk(
  samples: WxSample[],
  geometry: LngLat[],
  startM: number,
  endM: number,
  totalM: number
): WxSample[] {
  if (!samples.length || geometry.length < 2 || totalM < 1) return [];
  const lo = Math.min(startM, endM);
  const hi = Math.max(startM, endM);
  const span = hi - lo;
  const margin = Math.min(totalM * 0.06, Math.max(2500, span * 0.35));

  const inBand = samples.filter((s) => {
    const am = chordFractionToAlongMeters(geometry, s.t);
    return am >= lo - margin && am <= hi + margin;
  });
  if (inBand.length > 0) return inBand;

  /* Fallback: closest sample to chunk center */
  const mid = (lo + hi) / 2;
  let best = samples[0]!;
  let bestD = Infinity;
  for (const s of samples) {
    const am = chordFractionToAlongMeters(geometry, s.t);
    const d = Math.abs(am - mid);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return [best];
}
