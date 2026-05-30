import type { WxSample } from "./routeChunkWeather";

export type RouteOutlookStep = {
  key: string;
  shortLabel: string;
  /** 0 = route start, 1 = destination */
  fraction: number;
  tempF: number | null;
  conditions: string;
  precipPct: number | null;
  precipHint: number;
  /** e.g. "1h 21m" — empty at start */
  etaLabel: string | null;
  icon: string;
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
  return {
    tempF: tempMatch ? Number.parseInt(tempMatch[1]!, 10) : null,
    conditions,
    precipPct: precipMatch ? Number.parseInt(precipMatch[1]!, 10) : null,
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
    steps.push({
      key: meta.key,
      shortLabel: meta.shortLabel,
      fraction: meta.fraction,
      tempF: wx.tempF,
      conditions: wx.conditions,
      precipPct: wx.precipPct,
      precipHint: wx.precipPct != null ? Math.min(1, wx.precipPct / 100) : 0,
      etaLabel: parseEtaLabel(part),
      icon: wxIcon(wx.conditions, wx.precipPct != null ? wx.precipPct / 100 : 0),
    });
  }

  return steps;
}

function stepsFromSamples(samples: WxSample[]): RouteOutlookStep[] {
  return SAMPLE_FRACTIONS.map(({ fraction, shortLabel, key }) => {
    const sample = nearestSample(samples, fraction);
    const wx = parseWxBody(sample?.headline ?? "");
    const precipHint = sample?.precipHint ?? 0;
    const precipPct = precipHint > 0 ? Math.round(precipHint * 100) : null;
    return {
      key,
      shortLabel,
      fraction,
      tempF: wx.tempF,
      conditions: wx.conditions,
      precipPct,
      precipHint,
      etaLabel: null,
      icon: wxIcon(wx.conditions, precipHint),
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
    if (fromHeadline.length >= 2) return fromHeadline;
  }
  if (samples?.length) {
    return stepsFromSamples(samples);
  }
  if (h) {
    const wx = parseWxBody(h);
    return [
      {
        key: "route",
        shortLabel: labelForFraction(0.5),
        fraction: 0.5,
        tempF: wx.tempF,
        conditions: wx.conditions,
        precipPct: wx.precipPct,
        precipHint: 0,
        etaLabel: null,
        icon: wxIcon(wx.conditions),
      },
    ];
  }
  return [];
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
