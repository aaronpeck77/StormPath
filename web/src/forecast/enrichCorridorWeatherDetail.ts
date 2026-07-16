import type { RouteForecast } from "../services/tomorrowIo";
import {
  corridorColdLine,
  corridorFreezingLine,
  corridorLowVisibilityLine,
  corridorWetHeadline,
  corridorWetIntervalLine,
  worstCorridorInterval,
} from "./corridorForecastModel";

/**
 * Enrich corridor weather detail with the worst forecast interval timing.
 * "Thunderstorm in ~42 min" surfaces when the worst corridor segment is mid-route.
 */
export function enrichCorridorWeatherDetail(input: {
  corridorWeatherDetail: string;
  advisoryNowcastLine: string | null;
  tioRouteForecast: RouteForecast | null | undefined;
}): string {
  let base = input.corridorWeatherDetail;
  const baseLower = base.toLowerCase();
  const localLower = input.advisoryNowcastLine?.toLowerCase() ?? "";
  const tio = input.tioRouteForecast;

  if (
    baseLower.includes("dry along route") &&
    /\b(rain|drizzle|shower|precip|wet)\b/.test(localLower)
  ) {
    base = (tio?.intervals.length ? corridorWetHeadline(tio) : null) ?? "Rain along route";
  }
  if (!tio?.intervals.length) return base;

  const worst = worstCorridorInterval(tio);
  if (worst) {
    const etaLabel = worst.etaMinutes > 0 ? ` in ~${worst.etaMinutes} min` : "";
    const snapLine = `${worst.headline}${etaLabel} on route · ${worst.detail}`;
    if (base && !base.toLowerCase().includes(worst.headline.toLowerCase())) {
      return `${base} · ${snapLine}`;
    }
    return snapLine;
  }

  const wetLine = corridorWetIntervalLine(tio);
  if (wetLine) {
    if (base && !base.toLowerCase().includes(wetLine.split(" · ")[0]!.toLowerCase())) {
      return `${base} · ${wetLine}`;
    }
    return wetLine;
  }

  const extras: string[] = [];
  for (const line of [
    corridorFreezingLine(tio),
    corridorLowVisibilityLine(tio),
    corridorColdLine(tio),
  ]) {
    if (line && !base.toLowerCase().includes(line.split(" · ")[0]!.toLowerCase())) {
      extras.push(line);
    }
  }
  if (extras.length) {
    return base ? `${base} · ${extras.join(" · ")}` : extras.join(" · ");
  }
  return base;
}
