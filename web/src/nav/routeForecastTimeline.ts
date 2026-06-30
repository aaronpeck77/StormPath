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
import { formatCorridorTempLine } from "../forecast/corridorIntervalDisplay";
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
  /** Wind gust speed at this waypoint (mph) — null when not yet fetched */
  windGustMph?: number | null;
  /** mm/hr at this stop — suppresses chart noise from low POP alone */
  precipIntensityMmh?: number;
};

/** One sample on the along-route line graph (space + drive-time, not a fixed location). */
export type RouteOutlookPoint = {
  fraction: number;
  tempF: number | null;
  /** 0–100 precip likelihood along your drive at this point on the route */
  precipPct: number;
  /** mm/hr — when set, gates low POP from painting a noisy rain line */
  precipIntensityMmh?: number;
  shortLabel?: string;
  etaLabel?: string | null;
  conditions?: string;
  /** Wind gust speed at this point (mph) */
  windGustMph?: number | null;
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
  if (/tornado/.test(c)) return 80;
  if (/thunder|tstm|severe storm/.test(c)) return 75;
  if (/heavy (rain|shower)|torrential|flash flood/.test(c)) return 85;
  if (/\brain\b/.test(c)) return 65;
  if (/shower|drizzle/.test(c)) return 45;
  if (/snow|sleet|wintry|hail|blizzard|ice/.test(c)) return 55;
  if (/flood|hydro|surge/.test(c)) return 50;
  return null;
}

/**
 * Rain % for the route outlook chart — not raw model POP.
 * Long drives often show 15–35% POP at sparse corridor samples even on clear days;
 * require meaningful intensity, high confidence, or explicit rain wording before drawing the line.
 */
export function effectiveRoutePrecipDisplayPct(
  precipPct: number,
  precipIntensityMmh = 0,
  conditions = ""
): number {
  const pct = Math.max(0, Math.min(100, precipPct));
  const c = conditions.toLowerCase();
  const mentionsPrecip = /rain|shower|drizzle|storm|thunder|snow|sleet|freezing|wintry|hail/.test(c);

  if (precipIntensityMmh >= 0.5) return pct;
  if (precipIntensityMmh >= 0.12) {
    return pct >= 35 ? pct : Math.round(pct * 0.45);
  }
  if (pct >= 60 && mentionsPrecip) return pct;
  if (mentionsPrecip && pct >= 45) return Math.min(pct, 55);
  if (pct >= 50 && mentionsPrecip) return Math.round(pct * 0.6);
  return 0;
}

export type StormRouteOutlookBand = {
  startMeters: number;
  endMeters: number;
  headline: string;
};

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

function wxSampleHasTemp(sample: WxSample): boolean {
  return parseWxBody(sample.headline).tempF != null;
}

/** Merge corridor samples — prefer readings that include °F when OpenWeather hints lack temp. */
export function mergeRouteOutlookSamples(...groups: WxSample[][]): WxSample[] {
  const merged = new Map<number, WxSample>();
  for (const group of groups) {
    for (const sample of group) {
      const key = Math.round(sample.t * 400);
      const prev = merged.get(key);
      if (!prev) {
        merged.set(key, sample);
        continue;
      }
      const prevHasTemp = wxSampleHasTemp(prev);
      const nextHasTemp = wxSampleHasTemp(sample);
      const mergedWind = sample.windGustMph ?? prev.windGustMph ?? null;
      if (nextHasTemp && !prevHasTemp) {
        merged.set(key, { ...sample, windGustMph: mergedWind });
      } else if (prevHasTemp && !nextHasTemp) {
        merged.set(key, {
          ...prev,
          precipHint: Math.max(prev.precipHint, sample.precipHint),
          windGustMph: mergedWind,
        });
      } else {
        merged.set(key, {
          t: sample.t,
          precipHint: Math.max(prev.precipHint, sample.precipHint),
          headline: nextHasTemp || sample.headline.length > prev.headline.length ? sample.headline : prev.headline,
          windGustMph: mergedWind,
        });
      }
    }
  }
  return [...merged.values()].sort((a, b) => a.t - b.t);
}

/** Best-effort puck/route temp when storm-only graph stops lack corridor readings. */
export function resolveRouteOutlookAnchorTempF(opts: {
  nowcastTempF?: number | null;
  minutePrecipTempF?: number | null;
  hourlyTempF?: number | null;
  headline?: string;
  tioRouteForecast?: RouteForecast | null;
}): number | null {
  if (opts.nowcastTempF != null && Number.isFinite(opts.nowcastTempF)) {
    return Math.round(opts.nowcastTempF);
  }
  if (opts.minutePrecipTempF != null && Number.isFinite(opts.minutePrecipTempF)) {
    return Math.round(opts.minutePrecipTempF);
  }
  if (opts.hourlyTempF != null && Number.isFinite(opts.hourlyTempF)) {
    return Math.round(opts.hourlyTempF);
  }
  const fromHeadline = parseWxBody(opts.headline?.trim() ?? "").tempF;
  if (fromHeadline != null) return fromHeadline;
  const iv = opts.tioRouteForecast?.intervals?.[0];
  if (iv?.tempF != null && Number.isFinite(iv.tempF)) return Math.round(iv.tempF);
  return null;
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
      windGustMph: sample?.windGustMph ?? null,
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
      precipIntensityMmh: iv.precipIntensityMmh,
      headline: `${formatCorridorTempLine(iv)} ${conditions}${precipSuffix}`,
      windGustMph: iv.windGustMph > 0 ? Math.round(iv.windGustMph) : null,
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
      precipIntensityMmh: iv.precipIntensityMmh,
      etaLabel: null,
      icon: wxIcon(conditions, precipHint),
      windGustMph: iv.windGustMph != null ? Math.round(iv.windGustMph) : null,
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
          windGustMph: step.windGustMph ?? sample.windGustMph ?? null,
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
    const seed: RouteOutlookStep = {
      key: "midway",
      shortLabel: "Mid",
      fraction: 0.5,
      tempF: wx.tempF,
      conditions: wx.conditions,
      precipPct: precip.precipPct,
      precipHint: precip.precipHint,
      etaLabel: null,
      icon: wxIcon(wx.conditions, precip.precipHint),
    };
    return expandOutlookStepToRouteAxis(seed);
  }
  return [];
}

/** Spread one forecast reading across YOU→DEST so the line graph can render. */
function expandOutlookStepToRouteAxis(step: RouteOutlookStep): RouteOutlookStep[] {
  return SAMPLE_FRACTIONS.map(({ fraction, shortLabel, key }) => ({
    ...step,
    key,
    shortLabel,
    fraction,
  }));
}

function outlookStepHasChartValue(step: RouteOutlookStep): boolean {
  return (
    step.tempF != null ||
    (step.precipPct != null && step.precipPct > 0) ||
    step.precipHint > 0
  );
}

/**
 * Keep graph data aligned with route-info text — bottom copy can mention rain/temp even when
 * merge dropped a single-stop headline or milestone placeholders lack numbers yet.
 */
/**
 * Build route outlook stops from NWS / radar timeline bands and RainViewer samples —
 * used when forecast APIs are unavailable but storms show elsewhere in the app.
 */
export function buildOutlookFromStormAlongRoute(opts: {
  totalMeters: number;
  stormBands?: StormRouteOutlookBand[];
  radarSamples?: RadarOutlookSample[];
}): RouteOutlookStep[] {
  const { totalMeters, stormBands = [], radarSamples = [] } = opts;
  if (totalMeters <= 0) return [];

  const steps: RouteOutlookStep[] = [];
  for (const { fraction, shortLabel, key } of SAMPLE_FRACTIONS) {
    const alongM = fraction * totalMeters;
    const marginM = Math.max(400, totalMeters * 0.04);
    let conditions = "—";
    let precipPct: number | null = null;

    for (const band of stormBands) {
      if (alongM + marginM < band.startMeters || alongM - marginM > band.endMeters) continue;
      const text = band.headline.trim();
      if (!text) continue;
      const inferred = inferPrecipPctFromConditions(text);
      if (inferred != null) {
        precipPct = Math.max(precipPct ?? 0, inferred);
        conditions = text.split(" — ")[0]?.trim() || conditions;
      }
    }

    if (radarSamples.length) {
      const near = nearestRadarSample(radarSamples, fraction);
      if (near) {
        const radarPct = radarIntensityToPrecipPct(near.intensity);
        if (radarPct > (precipPct ?? 0)) {
          precipPct = radarPct;
          if (conditions === "—") {
            conditions = radarPct >= 48 ? "Heavy rain on route" : "Rain on route";
          }
        }
      }
    }

    const precip = effectivePrecipPct(precipPct, conditions);
    if (precip.precipPct == null && precip.precipHint <= 0) {
      continue;
    }
    steps.push({
      key,
      shortLabel,
      fraction,
      tempF: null,
      conditions,
      precipPct: precip.precipPct,
      precipHint: precip.precipHint,
      etaLabel: null,
      icon: wxIcon(conditions, precip.precipHint),
    });
  }

  return steps;
}

type TempStop = { fraction: number; tempF: number };

function interpolateTempAtFraction(fraction: number, stops: TempStop[]): number | null {
  if (!stops.length) return null;
  const sorted = [...stops].sort((a, b) => a.fraction - b.fraction);
  if (sorted.length === 1) return sorted[0]!.tempF;

  const f = Math.max(0, Math.min(1, fraction));
  if (f <= sorted[0]!.fraction) return sorted[0]!.tempF;
  const last = sorted[sorted.length - 1]!;
  if (f >= last.fraction) return last.tempF;

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]!;
    const b = sorted[i + 1]!;
    if (f < a.fraction || f > b.fraction) continue;
    const span = b.fraction - a.fraction;
    if (span <= 0.001) return a.tempF;
    const t = (f - a.fraction) / span;
    return Math.round(a.tempF + (b.tempF - a.tempF) * t);
  }
  return sorted[0]!.tempF;
}

/** Storm/radar graph stops often have rain but no temp — borrow from corridor samples or headline. */
function enrichRouteOutlookTemperature(
  steps: RouteOutlookStep[],
  opts: {
    samples?: WxSample[];
    headline?: string;
    anchorTempF?: number | null;
    tioRouteForecast?: RouteForecast | null;
    planEtaMinutes?: number | null;
  }
): RouteOutlookStep[] {
  if (!steps.length) return steps;

  const tempStops: TempStop[] = [];
  const seen = new Set<string>();

  const addStop = (fraction: number, tempF: number | null | undefined) => {
    if (tempF == null || !Number.isFinite(tempF)) return;
    const key = `${fraction.toFixed(3)}:${tempF}`;
    if (seen.has(key)) return;
    seen.add(key);
    tempStops.push({ fraction, tempF: Math.round(tempF) });
  };

  for (const step of steps) addStop(step.fraction, step.tempF);

  if (opts.samples?.length) {
    for (const { fraction } of SAMPLE_FRACTIONS) {
      const sample = nearestSample(opts.samples, fraction);
      addStop(fraction, parseWxBody(sample?.headline ?? "").tempF);
    }
    for (const sample of opts.samples) {
      addStop(sample.t, parseWxBody(sample.headline).tempF);
    }
  }

  if (
    opts.tioRouteForecast?.intervals.length &&
    opts.planEtaMinutes != null &&
    opts.planEtaMinutes > 0
  ) {
    for (const iv of opts.tioRouteForecast.intervals) {
      addStop(iv.etaMinutes / opts.planEtaMinutes, iv.tempF);
    }
  }

  const headline = opts.headline?.trim() ?? "";

  for (const step of stepsFromHeadline(headline)) {
    addStop(step.fraction, step.tempF);
  }

  if (!tempStops.length && headline) {
    addStop(0.5, parseWxBody(headline).tempF);
  }

  const anchorTempF =
    opts.anchorTempF != null && Number.isFinite(opts.anchorTempF)
      ? Math.round(opts.anchorTempF)
      : null;

  if (!tempStops.length && anchorTempF != null) {
    addStop(0, anchorTempF);
    addStop(1, anchorTempF);
  } else if (anchorTempF != null) {
    if (!tempStops.some((s) => s.fraction <= 0.001)) addStop(0, anchorTempF);
    if (!tempStops.some((s) => s.fraction >= 0.999)) addStop(1, anchorTempF);
  }

  if (!tempStops.length) return steps;

  return steps.map((step) => {
    if (step.tempF != null) return step;
    const tempF =
      interpolateTempAtFraction(step.fraction, tempStops) ??
      (anchorTempF != null ? anchorTempF : null);
    return tempF != null ? { ...step, tempF } : step;
  });
}

export function ensureRouteOutlookForGraph(opts: {
  steps: RouteOutlookStep[];
  samples?: WxSample[];
  headline?: string;
  totalMeters?: number;
  stormBands?: StormRouteOutlookBand[];
  radarSamples?: RadarOutlookSample[];
  /** Flat temp fallback when corridor APIs only supply rain/storm bands (e.g. nowcast at puck). */
  anchorTempF?: number | null;
  tioRouteForecast?: RouteForecast | null;
  planEtaMinutes?: number | null;
}): { steps: RouteOutlookStep[]; samples: WxSample[] } {
  const tioSamples =
    opts.tioRouteForecast && opts.planEtaMinutes && opts.planEtaMinutes > 0
      ? tomorrowForecastToWxSamples(opts.tioRouteForecast, opts.planEtaMinutes)
      : [];
  const samples = mergeRouteOutlookSamples(opts.samples ?? [], tioSamples);
  const headline = opts.headline?.trim() ?? "";
  const anchorTempF =
    opts.anchorTempF ??
    resolveRouteOutlookAnchorTempF({
      headline,
      tioRouteForecast: opts.tioRouteForecast,
    });
  let steps = opts.steps.filter(Boolean);
  const totalMeters = opts.totalMeters ?? 0;

  const chartable = steps.filter(outlookStepHasChartValue).length;
  if (steps.length < 2 || chartable === 0) {
    const fromSamples = samples.length ? stepsFromSamples(samples) : [];
    if (fromSamples.filter(outlookStepHasChartValue).length >= 2) {
      steps = fromSamples;
    } else {
      const fromHeadline = buildRouteOutlookTimeline(headline, samples);
      if (fromHeadline.filter(outlookStepHasChartValue).length >= 2) {
        steps = fromHeadline;
      } else if (fromHeadline.length === 1 && outlookStepHasChartValue(fromHeadline[0]!)) {
        steps = expandOutlookStepToRouteAxis(fromHeadline[0]!);
      } else if (fromSamples.length === 1 && outlookStepHasChartValue(fromSamples[0]!)) {
        steps = expandOutlookStepToRouteAxis(fromSamples[0]!);
      } else {
        const fromStorm =
          totalMeters > 0
            ? buildOutlookFromStormAlongRoute({
                totalMeters,
                stormBands: opts.stormBands,
                radarSamples: opts.radarSamples,
              })
            : [];
        if (fromStorm.filter(outlookStepHasChartValue).length >= 2) {
          steps = fromStorm;
        } else if (headline) {
          const wx = parseWxBody(headline);
          const precip = effectivePrecipPct(wx.precipPct, wx.conditions);
          if (wx.tempF != null || precip.precipPct != null || precip.precipHint > 0) {
            steps = expandOutlookStepToRouteAxis({
              key: "midway",
              shortLabel: "Mid",
              fraction: 0.5,
              tempF: wx.tempF,
              conditions: wx.conditions,
              precipPct: precip.precipPct,
              precipHint: precip.precipHint,
              etaLabel: null,
              icon: wxIcon(wx.conditions, precip.precipHint),
            });
          } else {
            const stormText = inferPrecipPctFromConditions(headline);
            if (stormText != null) {
              steps = expandOutlookStepToRouteAxis({
                key: "midway",
                shortLabel: "Mid",
                fraction: 0.5,
                tempF: null,
                conditions: headline.slice(0, 80),
                precipPct: stormText,
                precipHint: stormText / 100,
                etaLabel: null,
                icon: wxIcon(headline, stormText / 100),
              });
            }
          }
        } else if (fromStorm.length >= 2) {
          steps = fromStorm;
        } else if (fromStorm.length === 1 && outlookStepHasChartValue(fromStorm[0]!)) {
          steps = expandOutlookStepToRouteAxis(fromStorm[0]!);
        } else if (anchorTempF != null) {
          steps = expandOutlookStepToRouteAxis({
            key: "local-now",
            shortLabel: "Now",
            fraction: 0,
            tempF: anchorTempF,
            conditions: headline || "At your position",
            precipPct: null,
            precipHint: 0,
            etaLabel: null,
            icon: wxIcon(headline || "Clear", 0),
          });
        }
      }
    }
  } else if (steps.length < 2 && outlookStepHasChartValue(steps[0]!)) {
    steps = expandOutlookStepToRouteAxis(steps[0]!);
  }

  if (steps.some((s) => !outlookStepHasChartValue(s)) && (samples.length > 0 || headline)) {
    const fill = samples.length
      ? stepsFromSamples(samples)
      : buildRouteOutlookTimeline(headline, samples);
    if (fill.length) {
      steps = steps.map((step) => {
        if (outlookStepHasChartValue(step)) return step;
        const near =
          fill.find((f) => Math.abs(f.fraction - step.fraction) < 0.08) ??
          fill[Math.floor(fill.length / 2)]!;
        if (!near || !outlookStepHasChartValue(near)) return step;
        return {
          ...step,
          tempF: near.tempF,
          conditions: near.conditions,
          precipPct: near.precipPct,
          precipHint: near.precipHint,
          icon: near.icon,
        };
      });
    }
  }

  steps = enrichRouteOutlookTemperature(steps, {
    samples,
    headline,
    anchorTempF,
    tioRouteForecast: opts.tioRouteForecast,
    planEtaMinutes: opts.planEtaMinutes,
  });

  return { steps, samples };
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
  const raw =
    step.precipPct != null && step.precipPct > 0
      ? Math.min(100, step.precipPct)
      : Math.max(0, Math.min(100, Math.round(step.precipHint * 100)));
  return effectiveRoutePrecipDisplayPct(raw, step.precipIntensityMmh ?? 0, step.conditions);
}

/**
 * Conservative precip % from radar echo — mosaic fringe should not read as 100% POP.
 * Forecast APIs remain primary; this only supplements localized cells.
 */
export function radarIntensityToPrecipPct(intensity: number): number {
  const display = radarDisplayIntensity(intensity);
  if (display < RADAR_SOFT_THRESHOLD) return 0;
  if (display >= RADAR_VERY_HEAVY_THRESHOLD) return 72;
  if (display >= RADAR_HEAVY_THRESHOLD) return 55;
  if (display >= RADAR_REROUTE_THRESHOLD) return 36;
  const span = RADAR_REROUTE_THRESHOLD - RADAR_SOFT_THRESHOLD;
  const t = span > 0 ? (display - RADAR_SOFT_THRESHOLD) / span : 0;
  return Math.round(12 + t * 18);
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
        ? Math.min(100, current + Math.round((radarPct - current) * 0.28))
        : radarPct;

    const rainConditions =
      /rain|shower|drizzle|storm|thunder|snow/i.test(step.conditions)
        ? step.conditions
        : radarPct >= 48
          ? "Heavy rain on route"
          : "Rain on route";

    return {
      ...step,
      precipPct: boosted,
      precipHint: boosted / 100,
      conditions: rainConditions,
      icon: wxIcon(rainConditions, boosted / 100),
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
      const slotKey =
        SAMPLE_FRACTIONS.find((s) => s.key === step.key)?.key ??
        SAMPLE_FRACTIONS.reduce((best, s) =>
          Math.abs(s.fraction - step.fraction) < Math.abs(best.fraction - step.fraction) ? s : best
        ).key;
      const prev = merged.get(slotKey);
      if (!prev) {
        merged.set(slotKey, { ...step, key: slotKey });
        continue;
      }
      const precipA = precipPctFromStep(prev);
      const precipB = precipPctFromStep(step);
      const pickPrecip = precipB > precipA ? step : prev;
      const hint = Math.max(prev.precipHint, step.precipHint);
      const pct = Math.max(precipA, precipB);
      merged.set(slotKey, {
        ...prev,
        tempF: prev.tempF ?? step.tempF,
        conditions: pickPrecip.conditions || prev.conditions,
        precipPct: pct > 0 ? pct : null,
        precipHint: hint,
        windGustMph: step.windGustMph ?? prev.windGustMph ?? null,
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
      if (p.windGustMph != null) {
        prev.windGustMph = prev.windGustMph != null ? Math.round((prev.windGustMph + p.windGustMph) / 2) : p.windGustMph;
      }
      if (!prev.shortLabel && p.shortLabel) prev.shortLabel = p.shortLabel;
      if (!prev.etaLabel && p.etaLabel) prev.etaLabel = p.etaLabel;
      if (!prev.conditions && p.conditions) prev.conditions = p.conditions;
    } else {
      out.push({ ...p });
    }
  }
  return out;
}

function smoothPrecipAnchors(points: RouteOutlookPoint[]): RouteOutlookPoint[] {
  if (points.length <= 2) return points;
  const sorted = [...points].sort((a, b) => a.fraction - b.fraction);
  return sorted.map((p, i) => {
    if (i === 0 || i === sorted.length - 1) return p;
    const prev = sorted[i - 1]!;
    const next = sorted[i + 1]!;
    return {
      ...p,
      precipPct: Math.round((prev.precipPct + p.precipPct + next.precipPct) / 3),
    };
  });
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
      let windGustMph: number | null = null;
      if (a.windGustMph != null && b.windGustMph != null) {
        windGustMph = Math.round(a.windGustMph + (b.windGustMph - a.windGustMph) * t);
      } else if (a.windGustMph != null) windGustMph = a.windGustMph;
      else if (b.windGustMph != null) windGustMph = b.windGustMph;
      out.push({ fraction, tempF, precipPct, windGustMph });
    }
  }
  return mergeCloseOutlookPoints(out, 0.02);
}

/**
 * Dense series for the route outlook line graph — weather sampled along the polyline
 * as the driver moves (not a stationary point forecast).
 */
function tempFromNearestSample(samples: WxSample[], fraction: number): number | null {
  const sample = nearestSample(samples, fraction);
  return parseWxBody(sample?.headline ?? "").tempF;
}

export function buildRouteOutlookSeries(
  steps: RouteOutlookStep[],
  samples?: WxSample[]
): RouteOutlookPoint[] {
  const anchors: RouteOutlookPoint[] = [];

  for (const step of steps) {
    const tempF =
      step.tempF ?? (samples?.length ? tempFromNearestSample(samples, step.fraction) : null);
    anchors.push({
      fraction: step.fraction,
      tempF,
      precipPct: precipPctFromStep(step),
      precipIntensityMmh: step.precipIntensityMmh,
      windGustMph: step.windGustMph ?? null,
      shortLabel: step.shortLabel,
      etaLabel: step.etaLabel,
      conditions: step.conditions,
    });
  }

  if (samples?.length) {
    for (const sample of samples) {
      const fraction = Math.max(0, Math.min(1, sample.t));
      if (anchors.some((a) => Math.abs(a.fraction - fraction) < 0.03)) continue;
      const wx = parseWxBody(sample.headline);
      if (wx.tempF == null && anchors.some((a) => Math.abs(a.fraction - fraction) < 0.06)) continue;
      const precip = effectivePrecipPct(wx.precipPct, wx.conditions, sample.precipHint);
      const precipPct = effectiveRoutePrecipDisplayPct(
        precip.precipPct ?? Math.round(sample.precipHint * 100),
        sample.precipIntensityMmh ?? 0,
        wx.conditions
      );
      anchors.push({
        fraction,
        tempF: wx.tempF,
        precipPct,
        precipIntensityMmh: sample.precipIntensityMmh,
        windGustMph: sample.windGustMph ?? null,
        conditions: wx.conditions,
      });
    }
  }

  const merged = mergeCloseOutlookPoints(anchors);
  if (merged.length === 0) return [];
  const smoothed = smoothPrecipAnchors(merged);
  if (smoothed.length === 1) {
    const p = smoothed[0]!;
    const lo = Math.max(0, p.fraction - 0.02);
    const hi = Math.min(1, p.fraction + 0.02);
    if (lo === hi) {
      return [
        { ...p, fraction: 0 },
        { ...p, fraction: 1 },
      ];
    }
    return [
      { ...p, fraction: lo },
      { ...p, fraction: hi },
    ];
  }
  return interpolateOutlookSeries(smoothed);
}

export type RouteOutlookChartScale = {
  tempMin: number;
  tempMax: number;
  precipMax: number;
  windMax: number;
};

export function outlookChartScale(points: RouteOutlookPoint[]): RouteOutlookChartScale {
  const temps = points.map((p) => p.tempF).filter((t): t is number => t != null && Number.isFinite(t));
  const precipMax = Math.max(20, ...points.map((p) => p.precipPct), 0);
  const windGusts = points.map((p) => p.windGustMph).filter((g): g is number => g != null && g > 0);
  const windMax = windGusts.length ? Math.max(30, Math.ceil(Math.max(...windGusts) / 10) * 10) : 0;
  if (!temps.length) {
    return { tempMin: 50, tempMax: 80, precipMax, windMax };
  }
  const lo = Math.min(...temps);
  const hi = Math.max(...temps);
  const pad = Math.max(3, Math.round((hi - lo) * 0.12) || 4);
  return {
    tempMin: lo - pad,
    tempMax: hi + pad,
    precipMax: Math.min(100, Math.ceil(precipMax / 10) * 10),
    windMax,
  };
}
