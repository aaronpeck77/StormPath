import type { WxSample } from "./routeChunkWeather";
import {
  RADAR_HEAVY_THRESHOLD,
  RADAR_REROUTE_THRESHOLD,
  RADAR_SOFT_THRESHOLD,
  RADAR_VERY_HEAVY_THRESHOLD,
} from "./constants";
import { radarDisplayIntensity } from "./radarReflectivityScale";
import type { RouteForecast, RouteHourlyInterval } from "../services/tomorrowIo";
import { weatherCodeLabel } from "../services/tomorrowIo";
import { formatDurationMinutesMaybe } from "../ui/formatEta";

export type RadarOutlookSample = { t: number; intensity: number };

export type RouteOutlookStep = {
  key: string;
  shortLabel: string;
  /** 0 = route start, 1 = destination */
  fraction: number;
  /** Along-route meters — matches progress strip / hazard timeline axis */
  alongMeters?: number;
  tempF: number | null;
  conditions: string;
  precipPct: number | null;
  precipHint: number;
  /** e.g. "1h 21m" — synced with drive/plan ETA when not in headline */
  etaLabel: string | null;
  icon: string;
};

/** One sample on the along-route line graph (space + drive-time, not a fixed location). */
export type RouteOutlookPoint = {
  fraction: number;
  tempF: number | null;
  /** 0–100 precip likelihood along your drive at this point on the route */
  precipPct: number;
  shortLabel?: string;
  etaLabel?: string | null;
  conditions?: string;
};

const SPLIT_ROUTE_FORECAST = /\s*(?:→|\u2192)\s*/;

const FRACTION_LABELS: { match: RegExp; shortLabel: string; fraction: number; key: string }[] = [
  { match: /^Start\b/i, shortLabel: "Go", fraction: 0, key: "start" },
  { match: /^Quarter\b/i, shortLabel: "¼", fraction: 0.25, key: "quarter" },
  { match: /^Midway\b/i, shortLabel: "Mid", fraction: 0.5, key: "midway" },
  { match: /^3\/4/i, shortLabel: "¾", fraction: 0.75, key: "three-quarter" },
  { match: /^Destination\b/i, shortLabel: "End", fraction: 1, key: "end" },
];

const SAMPLE_FRACTIONS = [
  { fraction: 0, shortLabel: "Go", key: "start" },
  { fraction: 0.25, shortLabel: "¼", key: "quarter" },
  { fraction: 0.5, shortLabel: "Mid", key: "midway" },
  { fraction: 0.75, shortLabel: "¾", key: "three-quarter" },
  { fraction: 1, shortLabel: "End", key: "end" },
] as const;

function wxIcon(conditions: string, precipHint = 0): string {
  const c = conditions.toLowerCase();
  if (/thunder|tstm|storm/.test(c)) return "⛈";
  if (/snow|sleet|ice|wintry/.test(c)) return "❄";
  if (/rain|shower|drizzle/.test(c) || precipHint >= 0.45) return "🌧";
  if (/fog|mist/.test(c)) return "🌫";
  if (/wind/.test(c)) return "💨";
  if (/clear|sun/.test(c)) return "☀";
  return "☁";
}

function parseEtaLabel(part: string): string | null {
  const m = part.match(/\(in\s*~([^)]+)\)/i);
  if (!m?.[1]) return null;
  return m[1].trim().replace(/\s+/g, " ");
}

/** Estimate rain % from wording when OpenWeather omits an explicit pop in the headline. */
export function inferPrecipPctFromConditions(conditions: string): number | null {
  const c = conditions.toLowerCase();
  if (/thunder|tstm|storm/.test(c)) return 75;
  if (/heavy (rain|shower)|torrential/.test(c)) return 85;
  if (/\brain\b/.test(c)) return 65;
  if (/shower|drizzle/.test(c)) return 45;
  if (/snow|sleet|wintry|hail/.test(c)) return 55;
  return null;
}

function effectivePrecipPct(
  parsedPct: number | null,
  conditions: string,
  precipHint = 0
): { precipPct: number | null; precipHint: number } {
  const fromHint = precipHint > 0 ? Math.round(precipHint * 100) : null;
  const fromConditions = inferPrecipPctFromConditions(conditions);
  let precipPct = parsedPct;
  if (precipPct == null || precipPct <= 0) {
    precipPct = fromHint ?? fromConditions;
  }
  const hint =
    precipPct != null && precipPct > 0
      ? Math.max(precipHint, precipPct / 100)
      : precipHint;
  return { precipPct, precipHint: hint };
}

function parseWxBody(text: string): {
  tempF: number | null;
  conditions: string;
  precipPct: number | null;
} {
  const tempMatch = text.match(/(-?\d+)\s*°F/i);
  const precipMatch = text.match(/(\d+)%\s*precip/i);
  let conditions = text
    .replace(/^(Start|Quarter|Midway|3\/4 mark|Destination)(\([^)]*\))?:?\s*/i, "")
    .replace(/(-?\d+)\s*°F\s*/i, "")
    .replace(/;\s*clouds\s*\d+%/gi, "")
    .replace(/\s*\d+%\s*precip/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!conditions) conditions = "—";
  const parsedPct = precipMatch ? Number.parseInt(precipMatch[1]!, 10) : null;
  const { precipPct } = effectivePrecipPct(parsedPct, conditions);
  return {
    tempF: tempMatch ? Number.parseInt(tempMatch[1]!, 10) : null,
    conditions,
    precipPct,
  };
}

function labelForFraction(fraction: number): string {
  const hit = SAMPLE_FRACTIONS.find((s) => Math.abs(s.fraction - fraction) < 0.001);
  return hit?.shortLabel ?? `${Math.round(fraction * 100)}%`;
}

function nearestSample(samples: WxSample[], fraction: number): WxSample | null {
  if (!samples.length) return null;
  let best = samples[0]!;
  let bestD = Infinity;
  for (const s of samples) {
    const d = Math.abs(s.t - fraction);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

function stepsFromHeadline(forecastHeadline: string): RouteOutlookStep[] {
  const parts = forecastHeadline
    .trim()
    .split(SPLIT_ROUTE_FORECAST)
    .map((s) => s.trim())
    .filter(Boolean);
  const steps: RouteOutlookStep[] = [];

  for (const part of parts) {
    const meta = FRACTION_LABELS.find((x) => x.match.test(part));
    if (!meta) continue;
    const wx = parseWxBody(part);
    const precip = effectivePrecipPct(wx.precipPct, wx.conditions);
    steps.push({
      key: meta.key,
      shortLabel: meta.shortLabel,
      fraction: meta.fraction,
      tempF: wx.tempF,
      conditions: wx.conditions,
      precipPct: precip.precipPct,
      precipHint: precip.precipHint,
      etaLabel: parseEtaLabel(part),
      icon: wxIcon(wx.conditions, precip.precipHint),
    });
  }

  return steps;
}

function stepsFromSamples(samples: WxSample[]): RouteOutlookStep[] {
  return SAMPLE_FRACTIONS.map(({ fraction, shortLabel, key }) => {
    const sample = nearestSample(samples, fraction);
    const wx = parseWxBody(sample?.headline ?? "");
    const precip = effectivePrecipPct(wx.precipPct, wx.conditions, sample?.precipHint ?? 0);
    return {
      key,
      shortLabel,
      fraction,
      tempF: wx.tempF,
      conditions: wx.conditions,
      precipPct: precip.precipPct,
      precipHint: precip.precipHint,
      etaLabel: null,
      icon: wxIcon(wx.conditions, precip.precipHint),
    };
  });
}

function nearestIntervalByEta(
  intervals: RouteHourlyInterval[],
  etaMin: number
): RouteHourlyInterval | null {
  if (!intervals.length) return null;
  let best = intervals[0]!;
  let bestD = Infinity;
  for (const iv of intervals) {
    const d = Math.abs(iv.etaMinutes - etaMin);
    if (d < bestD) {
      bestD = d;
      best = iv;
    }
  }
  return best;
}

/** Convert Tomorrow.io corridor forecast → along-route graph samples. */
export function tomorrowForecastToWxSamples(
  forecast: RouteForecast,
  planEtaMinutes: number
): WxSample[] {
  if (!forecast.intervals.length || planEtaMinutes <= 0) return [];
  return forecast.intervals.map((iv) => {
    const conditions = weatherCodeLabel(iv.weatherCode);
    const precipPct = Math.round(iv.precipProbability * 100);
    const precipSuffix = precipPct > 0 ? ` ${precipPct}% precip` : "";
    return {
      t: Math.min(1, Math.max(0, iv.etaMinutes / planEtaMinutes)),
      precipHint: iv.precipProbability,
      headline: `${Math.round(iv.tempF)}°F ${conditions}${precipSuffix}`,
    };
  });
}

/** Five-stop outlook from Tomorrow.io when OpenWeather corridor data is unavailable. */
export function buildRouteOutlookFromTomorrowForecast(
  forecast: RouteForecast,
  planEtaMinutes: number
): RouteOutlookStep[] {
  if (!forecast.intervals.length || planEtaMinutes <= 0) return [];

  return SAMPLE_FRACTIONS.map(({ fraction, shortLabel, key }) => {
    const etaMin = fraction * planEtaMinutes;
    const iv = nearestIntervalByEta(forecast.intervals, etaMin)!;
    const conditions = weatherCodeLabel(iv.weatherCode);
    const precipPct = Math.round(iv.precipProbability * 100);
    const precipHint = iv.precipProbability;
    return {
      key,
      shortLabel,
      fraction,
      tempF: Math.round(iv.tempF),
      conditions,
      precipPct: precipPct > 0 ? precipPct : null,
      precipHint,
      etaLabel: null,
      icon: wxIcon(conditions, precipHint),
    };
  });
}

/** Structured stops for a glanceable route weather timeline. */
export function buildRouteOutlookTimeline(
  forecastHeadline: string,
  samples?: WxSample[]
): RouteOutlookStep[] {
  const h = forecastHeadline.trim();
  if (h && SPLIT_ROUTE_FORECAST.test(h)) {
    const fromHeadline = stepsFromHeadline(h);
    if (fromHeadline.length >= 2) {
      if (!samples?.length) return fromHeadline;
      return fromHeadline.map((step) => {
        const sample = nearestSample(samples, step.fraction);
        if (!sample) return step;
        const wx = parseWxBody(sample.headline);
        const precip = effectivePrecipPct(
          step.precipPct ?? wx.precipPct,
          step.conditions || wx.conditions,
          Math.max(step.precipHint, sample.precipHint)
        );
        if (
          (step.precipPct == null || step.precipPct <= 0) &&
          (precip.precipPct == null || precip.precipPct <= 0)
        ) {
          return step;
        }
        return {
          ...step,
          precipPct: precip.precipPct,
          precipHint: precip.precipHint,
          icon: wxIcon(step.conditions, precip.precipHint),
        };
      });
    }
  }
  if (samples?.length) {
    return stepsFromSamples(samples);
  }
  if (h) {
    const wx = parseWxBody(h);
    const precip = effectivePrecipPct(wx.precipPct, wx.conditions);
    return [
      {
        key: "route",
        shortLabel: labelForFraction(0.5),
        fraction: 0.5,
        tempF: wx.tempF,
        conditions: wx.conditions,
        precipPct: precip.precipPct,
        precipHint: precip.precipHint,
        etaLabel: null,
        icon: wxIcon(wx.conditions, precip.precipHint),
      },
    ];
  }
  return [];
}

/** Placeholder outlook for cross-country legs when corridor wx samples are not ready yet. */
export function buildMilestoneRouteOutlook(
  totalMeters: number,
  planEtaMinutes: number | null,
  headline?: string
): RouteOutlookStep[] {
  if (totalMeters <= 0) return [];
  const h = headline?.trim();
  const fractions = [0, 0.25, 0.5, 0.75, 1] as const;
  return fractions.map((fraction) => {
    const alongMeters = fraction * totalMeters;
    const etaLabel =
      planEtaMinutes != null && planEtaMinutes > 0
        ? formatDurationMinutesMaybe(Math.max(1, Math.round(planEtaMinutes * fraction)))
        : null;
    return {
      key: `mile-${fraction}`,
      shortLabel: labelForFraction(fraction),
      fraction,
      alongMeters,
      tempF: null,
      conditions: h && fraction === 0.5 ? h.slice(0, 48) : "Along route",
      precipPct: null,
      precipHint: 0,
      etaLabel,
      icon: fraction === 0 ? "🚗" : fraction === 1 ? "🏁" : "📍",
    };
  });
}

/** Same remaining-trip ETA model as {@link formatRouteAlertTiming} / progress strip. */
function effectiveRemainingEtaMinutes(
  totalMeters: number,
  userAlongMeters: number,
  planEtaMinutes: number | null,
  driveEtaMinutes?: number | null
): number | null {
  const remainingM = Math.max(0, totalMeters - userAlongMeters);
  if (remainingM <= 0) return 0;
  if (driveEtaMinutes != null && Number.isFinite(driveEtaMinutes)) return driveEtaMinutes;
  if (planEtaMinutes != null && Number.isFinite(planEtaMinutes) && totalMeters > 0) {
    return planEtaMinutes * (remainingM / totalMeters);
  }
  return null;
}

function etaMinutesAtAlongMeters(
  targetM: number,
  totalMeters: number,
  userAlongMeters: number,
  planEtaMinutes: number | null,
  driveEtaMinutes?: number | null
): number | null {
  const remainingM = Math.max(0, totalMeters - userAlongMeters);
  const effectiveEta = effectiveRemainingEtaMinutes(
    totalMeters,
    userAlongMeters,
    planEtaMinutes,
    driveEtaMinutes
  );
  if (effectiveEta == null || remainingM <= 0) return null;
  const ahead = Math.max(0, targetM - userAlongMeters);
  if (ahead <= 0) return 0;
  return effectiveEta * (ahead / remainingM);
}

/**
 * Route outlook stops aligned to the same along-route axis as the progress strip,
 * hazard timeline, and advisory panel — ETAs use drive/plan remaining time.
 */
export function buildSyncedRouteOutlook(opts: {
  forecastHeadline: string;
  samples?: WxSample[];
  totalMeters: number;
  userAlongMeters: number;
  planEtaMinutes: number | null;
  driveEtaMinutes?: number | null;
}): RouteOutlookStep[] {
  const {
    forecastHeadline,
    samples,
    totalMeters,
    userAlongMeters,
    planEtaMinutes,
    driveEtaMinutes = null,
  } = opts;

  const base = buildRouteOutlookTimeline(forecastHeadline, samples);
  if (!base.length || totalMeters <= 0) return base;

  return base.map((step) => {
    const alongMeters = Math.min(totalMeters, Math.max(0, step.fraction * totalMeters));
    let etaLabel = step.etaLabel;
    if (!etaLabel) {
      const enterMin = etaMinutesAtAlongMeters(
        alongMeters,
        totalMeters,
        userAlongMeters,
        planEtaMinutes,
        driveEtaMinutes
      );
      const fmt = formatDurationMinutesMaybe(enterMin);
      if (fmt) {
        etaLabel = step.fraction <= 0.001 ? "Now" : fmt === "now" ? "Now" : fmt;
      } else if (step.fraction <= 0.001) {
        etaLabel = "Now";
      }
    }
    return { ...step, alongMeters, etaLabel };
  });
}

export function routeOutlookAriaLabel(steps: RouteOutlookStep[]): string {
  return steps
    .map((s) => {
      const temp = s.tempF != null ? `${s.tempF}°F` : "";
      const precip = s.precipPct != null && s.precipPct > 0 ? `${s.precipPct}% rain` : "";
      const eta = s.etaLabel ? ` in ${s.etaLabel}` : "";
      return `${s.shortLabel}${eta}: ${[temp, s.conditions, precip].filter(Boolean).join(", ")}`;
    })
    .join(". ");
}

export function precipBarHeight(step: RouteOutlookStep): number {
  if (step.precipPct != null && step.precipPct > 0) {
    return Math.max(8, Math.min(100, step.precipPct));
  }
  return Math.max(0, Math.min(100, Math.round(step.precipHint * 100)));
}

export function precipPctFromStep(step: RouteOutlookStep): number {
  if (step.precipPct != null && step.precipPct > 0) return Math.min(100, step.precipPct);
  return Math.max(0, Math.min(100, Math.round(step.precipHint * 100)));
}

/**
 * Conservative precip % from radar echo — mosaic fringe should not read as 100% POP.
 * Forecast APIs remain primary; this only supplements localized cells.
 */
export function radarIntensityToPrecipPct(intensity: number): number {
  const display = radarDisplayIntensity(intensity);
  if (display < RADAR_SOFT_THRESHOLD) return 0;
  if (display >= RADAR_VERY_HEAVY_THRESHOLD) return 88;
  if (display >= RADAR_HEAVY_THRESHOLD) return 68;
  if (display >= RADAR_REROUTE_THRESHOLD) return 48;
  const span = RADAR_REROUTE_THRESHOLD - RADAR_SOFT_THRESHOLD;
  const t = span > 0 ? (display - RADAR_SOFT_THRESHOLD) / span : 0;
  return Math.round(18 + t * 24);
}

function nearestRadarSample(samples: RadarOutlookSample[], fraction: number): RadarOutlookSample | null {
  if (!samples.length) return null;
  let best = samples[0]!;
  let bestD = Infinity;
  for (const s of samples) {
    const d = Math.abs(s.t - fraction);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

/**
 * Nudge forecast stops upward only where radar echo is stronger than along the rest of the route.
 * Skips uniform mosaic noise that was painting 100% rain on every leg.
 */
export function applyRadarOutlookBoost(
  steps: RouteOutlookStep[],
  radarSamples: RadarOutlookSample[]
): RouteOutlookStep[] {
  if (!steps.length || !radarSamples.length) return steps;

  const displays = radarSamples.map((s) => radarDisplayIntensity(s.intensity));
  const routeMin = Math.min(...displays);
  const routeMax = Math.max(...displays);
  if (routeMax < RADAR_SOFT_THRESHOLD || routeMax - routeMin < 0.12) {
    return steps;
  }

  return steps.map((step) => {
    const near = nearestRadarSample(radarSamples, step.fraction);
    if (!near) return step;
    const display = radarDisplayIntensity(near.intensity);
    if (display - routeMin < 0.12) return step;

    const radarPct = radarIntensityToPrecipPct(near.intensity);
    if (radarPct <= 0) return step;

    const current = precipPctFromStep(step);
    if (current >= radarPct) return step;

    const boosted =
      current > 0
        ? Math.min(100, current + Math.round((radarPct - current) * 0.45))
        : radarPct;

    return {
      ...step,
      precipPct: boosted,
      precipHint: boosted / 100,
      icon: wxIcon(step.conditions, boosted / 100),
    };
  });
}

const KEY_TO_HEADLINE_LABEL: Record<string, string> = {
  start: "Start",
  quarter: "Quarter",
  midway: "Midway",
  "three-quarter": "3/4 mark",
  end: "Destination",
};

function outlookHeadlineFromSteps(steps: RouteOutlookStep[]): string {
  return [...steps]
    .sort((a, b) => a.fraction - b.fraction)
    .map((s) => {
      const label = KEY_TO_HEADLINE_LABEL[s.key] ?? s.shortLabel;
      const temp = s.tempF != null ? `${s.tempF}°F ` : "";
      const precip =
        s.precipPct != null && s.precipPct > 0 ? `${s.precipPct}% precip ` : "";
      const eta = s.etaLabel && s.etaLabel !== "Now" ? ` (in ~${s.etaLabel})` : "";
      return `${label}${eta}: ${temp}${s.conditions} ${precip}`.replace(/\s+/g, " ").trim();
    })
    .join(" → ");
}

/** Re-apply drive-synced ETAs after merging multiple outlook sources. */
export function resyncRouteOutlookSteps(
  steps: RouteOutlookStep[],
  opts: {
    samples?: WxSample[];
    totalMeters: number;
    userAlongMeters: number;
    planEtaMinutes: number | null;
    driveEtaMinutes?: number | null;
  }
): RouteOutlookStep[] {
  if (!steps.length) return [];
  return buildSyncedRouteOutlook({
    forecastHeadline: outlookHeadlineFromSteps(steps),
    samples: opts.samples,
    totalMeters: opts.totalMeters,
    userAlongMeters: opts.userAlongMeters,
    planEtaMinutes: opts.planEtaMinutes,
    driveEtaMinutes: opts.driveEtaMinutes ?? null,
  });
}

/** Keep the richest temp/precip stop when OpenWeather, Tomorrow.io, and radar disagree. */
export function mergeRouteOutlookSteps(...groups: RouteOutlookStep[][]): RouteOutlookStep[] {
  const merged = new Map<string, RouteOutlookStep>();
  for (const steps of groups) {
    for (const step of steps) {
      const prev = merged.get(step.key);
      if (!prev) {
        merged.set(step.key, step);
        continue;
      }
      const precipA = precipPctFromStep(prev);
      const precipB = precipPctFromStep(step);
      const pickPrecip = precipB > precipA ? step : prev;
      const hint = Math.max(prev.precipHint, step.precipHint);
      const pct = Math.max(precipA, precipB);
      merged.set(step.key, {
        ...prev,
        tempF: prev.tempF ?? step.tempF,
        conditions: pickPrecip.conditions || prev.conditions,
        precipPct: pct > 0 ? pct : null,
        precipHint: hint,
        etaLabel: prev.etaLabel ?? step.etaLabel,
        alongMeters: prev.alongMeters ?? step.alongMeters,
        icon: wxIcon(pickPrecip.conditions || prev.conditions, hint),
      });
    }
  }
  return SAMPLE_FRACTIONS.map(({ key }) => merged.get(key)).filter(
    (s): s is RouteOutlookStep => Boolean(s)
  );
}

function mergeCloseOutlookPoints(points: RouteOutlookPoint[], gap = 0.035): RouteOutlookPoint[] {
  if (points.length <= 1) return points;
  const sorted = [...points].sort((a, b) => a.fraction - b.fraction);
  const out: RouteOutlookPoint[] = [sorted[0]!];
  for (let i = 1; i < sorted.length; i++) {
    const p = sorted[i]!;
    const prev = out[out.length - 1]!;
    if (p.fraction - prev.fraction < gap) {
      const w0 = 1;
      const w1 = 1;
      prev.fraction = (prev.fraction * w0 + p.fraction * w1) / (w0 + w1);
      if (p.tempF != null) {
        prev.tempF =
          prev.tempF != null ? Math.round((prev.tempF + p.tempF) / 2) : p.tempF;
      }
      prev.precipPct = Math.max(prev.precipPct, p.precipPct);
      if (!prev.shortLabel && p.shortLabel) prev.shortLabel = p.shortLabel;
      if (!prev.etaLabel && p.etaLabel) prev.etaLabel = p.etaLabel;
      if (!prev.conditions && p.conditions) prev.conditions = p.conditions;
    } else {
      out.push({ ...p });
    }
  }
  return out;
}

/** Linear fill between known route forecast stops for a smooth along-drive line. */
function interpolateOutlookSeries(anchors: RouteOutlookPoint[], slices = 12): RouteOutlookPoint[] {
  if (anchors.length === 0) return [];
  if (anchors.length === 1) return anchors;
  const sorted = [...anchors].sort((a, b) => a.fraction - b.fraction);
  const out: RouteOutlookPoint[] = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]!;
    const b = sorted[i + 1]!;
    const span = b.fraction - a.fraction;
    if (span <= 0.001) continue;
    const steps = Math.max(2, Math.round(span * slices));
    for (let s = 0; s <= steps; s++) {
      if (i > 0 && s === 0) continue;
      const t = s / steps;
      const fraction = a.fraction + span * t;
      let tempF: number | null = null;
      if (a.tempF != null && b.tempF != null) {
        tempF = Math.round(a.tempF + (b.tempF - a.tempF) * t);
      } else if (a.tempF != null) tempF = a.tempF;
      else if (b.tempF != null) tempF = b.tempF;
      const precipPct = Math.round(a.precipPct + (b.precipPct - a.precipPct) * t);
      out.push({ fraction, tempF, precipPct });
    }
  }
  return mergeCloseOutlookPoints(out, 0.02);
}

/**
 * Dense series for the route outlook line graph — weather sampled along the polyline
 * as the driver moves (not a stationary point forecast).
 */
export function buildRouteOutlookSeries(
  steps: RouteOutlookStep[],
  samples?: WxSample[]
): RouteOutlookPoint[] {
  const anchors: RouteOutlookPoint[] = [];

  for (const step of steps) {
    anchors.push({
      fraction: step.fraction,
      tempF: step.tempF,
      precipPct: precipPctFromStep(step),
      shortLabel: step.shortLabel,
      etaLabel: step.etaLabel,
      conditions: step.conditions,
    });
  }

  if (samples?.length) {
    for (const sample of samples) {
      const fraction = Math.max(0, Math.min(1, sample.t));
      if (steps.some((s) => Math.abs(s.fraction - fraction) < 0.06)) continue;
      const wx = parseWxBody(sample.headline);
      const precip = effectivePrecipPct(wx.precipPct, wx.conditions, sample.precipHint);
      const precipPct = precip.precipPct ?? 0;
      anchors.push({
        fraction,
        tempF: wx.tempF,
        precipPct,
        conditions: wx.conditions,
      });
    }
  }

  const merged = mergeCloseOutlookPoints(anchors);
  if (merged.length < 2) return merged;
  return interpolateOutlookSeries(merged);
}

export type RouteOutlookChartScale = {
  tempMin: number;
  tempMax: number;
  precipMax: number;
};

export function outlookChartScale(points: RouteOutlookPoint[]): RouteOutlookChartScale {
  const temps = points.map((p) => p.tempF).filter((t): t is number => t != null && Number.isFinite(t));
  const precipMax = Math.max(20, ...points.map((p) => p.precipPct), 0);
  if (!temps.length) {
    return { tempMin: 50, tempMax: 80, precipMax };
  }
  const lo = Math.min(...temps);
  const hi = Math.max(...temps);
  const pad = Math.max(3, Math.round((hi - lo) * 0.12) || 4);
  return {
    tempMin: lo - pad,
    tempMax: hi + pad,
    precipMax: Math.min(100, Math.ceil(precipMax / 10) * 10),
  };
}
