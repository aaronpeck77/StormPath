import type {
  MinutePrecipForecast,
  MinutePrecipNowSnapshot,
  PointDailyDay,
  PointHourlyInterval,
} from "../services/tomorrowIo";
import type { NormalizedWeatherAlert } from "../weatherAlerts/types";
import { displayText } from "./displayText";
import { formatEtaDuration } from "../ui/formatEta";

/** Short place label for forecast headers (Mapbox `place_name` is often a full address). */
export function shortenPlaceNameForForecast(placeName: string): string {
  const parts = placeName
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length >= 3) {
    const state = parts[parts.length - 2]!;
    const city = parts[parts.length - 3]!;
    if (city && state) return `${city}, ${state}`;
  }
  if (parts.length >= 2) return `${parts[0]}, ${parts[1]}`;
  return parts[0] ?? placeName.trim();
}

/** Fallback when reverse geocode has not returned yet. */
export function formatCoordsAreaLabel(lat: number, lng: number): string {
  const latHem = lat >= 0 ? "N" : "S";
  const lngHem = lng >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(2)}°${latHem}, ${Math.abs(lng).toFixed(2)}°${lngHem}`;
}

/** Newest fetch time across one or more forecast sources. */
export function latestForecastFetchedAtMs(
  ...sources: Array<number | null | undefined>
): number | null {
  const times = sources.filter((t): t is number => t != null && Number.isFinite(t));
  return times.length ? Math.max(...times) : null;
}

export function formatForecastUpdatedAt(fetchedAtMs: number): string {
  const ageMin = (Date.now() - fetchedAtMs) / 60_000;
  if (ageMin < 2) return "Updated just now";
  if (ageMin < 55) return `Updated ${formatEtaDuration(ageMin)} ago`;
  return `Updated ${new Date(fetchedAtMs).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

/** Compact freshness label for the collapsed advisory banner. */
export function formatForecastUpdatedShort(fetchedAtMs: number): string {
  const ageMin = (Date.now() - fetchedAtMs) / 60_000;
  if (ageMin < 2) return "just now";
  if (ageMin < 55) return `${Math.round(ageMin)}m ago`;
  return new Date(fetchedAtMs).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function truncateBannerText(text: string, maxLen: number): string {
  const t = text.trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`;
}

/** Compact “right now” line when OpenWeather is unavailable (uses Tomorrow.io snapshot). */
export function formatMinutePrecipNowLine(now: MinutePrecipNowSnapshot): string {
  const parts = [`${now.tempF}°F`];
  if (now.windMph >= 1) parts.push(`Wind ${now.windMph} mph`);
  if (now.conditions) parts.push(now.conditions);
  return parts.join(" · ");
}

/** Short label for an hourly column (Now, 3p, 12a, …). */
export function formatLocalForecastHourLabel(offsetHours: number, index: number): string {
  if (index === 0 || offsetHours < 0.75) return "Now";
  const d = new Date(Date.now() + offsetHours * 3_600_000);
  return d.toLocaleTimeString(undefined, { hour: "numeric" }).replace(/\s/g, "");
}

/** One-line read on the 24-hour strip. */
export function pointHourlyForecastSummary(hours: PointHourlyInterval[]): string {
  if (!hours.length) return "";
  const wet = hours.filter(
    (h) => h.precipProbability > 0.25 || h.precipIntensityMmh > 0.15
  );
  if (!wet.length) return "Dry for the next 24 hours";
  const firstH = Math.max(0, Math.round(wet[0]!.offsetHours));
  const lastH = Math.round(wet[wet.length - 1]!.offsetHours);
  if (firstH <= 1 && lastH >= 18) return "Precip likely much of the next day";
  // "through about Xh" was ambiguous — reword as "Rain continuing for ~Xh" or "Rain expected — clearing by Xh"
  if (firstH <= 1 && lastH <= 2) return `Rain expected — clearing in ~${lastH}h`;
  if (firstH <= 1) return `Rain expected — clearing around ${lastH}h from now`;
  if (firstH === lastH) return `Rain possible around ${firstH}h from now`;
  return `Rain possible ${firstH}–${lastH}h from now`;
}

/** One-line read on the multi-day outlook. */
export function pointDailyForecastSummary(days: PointDailyDay[]): string {
  if (!days.length) return "";
  const wet = days.filter((d) => d.precipChance >= 0.35);
  if (!wet.length) return "Dry for the next few days";
  if (wet.length === days.length) return "Rain possible most days ahead";
  const first = wet[0]!;
  if (wet.length === 1) return `${first.dayLabel}: ${Math.round(first.precipChance * 100)}% rain`;
  return `Rain possible ${wet[0]!.dayLabel}–${wet[wet.length - 1]!.dayLabel}`;
}

/** Short day label for daily chips (Today, Wed, Thu…). */
export function formatDailyDayLabel(day: PointDailyDay, index: number): string {
  if (index === 0) return "Today";
  return day.dayLabel;
}

export function minutePrecipBannerHint(forecast: MinutePrecipForecast): string {
  const minutes = forecast.minutes.slice(0, 60);
  const wet = minutes.findIndex((m) => m.precipIntensityMmh > 0.1);
  if (wet < 0) return "Dry next hour";
  if (wet === 0) return "Rain now";
  if (wet <= 20) return `Rain ~${formatEtaDuration(wet)}`;
  return `Rain ~${formatEtaDuration(wet)}`;
}

export type LocalForecastBannerItem = {
  badge: "Local";
  raw: string;
  localMeta: { area: string; updated: string | null };
};

/** One-line NWS hint for the collapsed Local rotator slot. */
export function nwsLocalForecastBannerHint(alerts: NormalizedWeatherAlert[]): string | null {
  if (!alerts.length) return null;
  const top = alerts[0]!;
  const ev = top.event?.trim() || "Weather alert";
  if (alerts.length === 1) return `${ev} near you`;
  return `${ev} +${alerts.length - 1} more near you`;
}

/** Single rotator slot: local area + freshness + compact conditions (banner only). */
export function buildLocalForecastBannerItem(opts: {
  areaLabel: string;
  nowcastLine: string | null;
  minutePrecip?: MinutePrecipForecast | null;
  fetchedAtMs: number | null;
  /** Active NWS alerts near you (shown after conditions). */
  nwsNearYou?: NormalizedWeatherAlert[] | null;
}): LocalForecastBannerItem | null {
  const parts: string[] = [];
  if (opts.nowcastLine) parts.push(displayText(opts.nowcastLine));
  if (opts.minutePrecip?.minutes.length) {
    parts.push(minutePrecipBannerHint(opts.minutePrecip));
  }
  const nwsLine = opts.nwsNearYou?.length ? nwsLocalForecastBannerHint(opts.nwsNearYou) : null;
  if (nwsLine) parts.push(displayText(nwsLine));
  if (!parts.length) return null;
  return {
    badge: "Local",
    raw: truncateBannerText(parts.join(" · "), 96),
    localMeta: {
      area: opts.areaLabel.trim(),
      updated: opts.fetchedAtMs != null ? formatForecastUpdatedShort(opts.fetchedAtMs) : null,
    },
  };
}
