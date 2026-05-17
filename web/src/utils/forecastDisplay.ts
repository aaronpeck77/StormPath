import type { MinutePrecipForecast } from "../services/tomorrowIo";

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
  if (ageMin < 55) return `Updated ${Math.round(ageMin)} min ago`;
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

export function minutePrecipBannerHint(forecast: MinutePrecipForecast): string {
  const minutes = forecast.minutes.slice(0, 60);
  const wet = minutes.findIndex((m) => m.precipIntensityMmh > 0.1);
  if (wet < 0) return "Dry next hour";
  if (wet === 0) return "Rain now";
  if (wet <= 20) return `Rain ~${wet}m`;
  return `Rain ~${wet}m`;
}

export type LocalForecastBannerItem = {
  badge: "Local";
  raw: string;
  localMeta: { area: string; updated: string | null };
};

/** Single rotator slot: local area + freshness + compact conditions (banner only). */
export function buildLocalForecastBannerItem(opts: {
  areaLabel: string;
  nowcastLine: string | null;
  minutePrecip?: MinutePrecipForecast | null;
  fetchedAtMs: number | null;
}): LocalForecastBannerItem | null {
  const parts: string[] = [];
  if (opts.nowcastLine) parts.push(truncateBannerText(opts.nowcastLine, 48));
  if (opts.minutePrecip?.minutes.length) {
    parts.push(minutePrecipBannerHint(opts.minutePrecip));
  }
  if (!parts.length) return null;
  return {
    badge: "Local",
    raw: truncateBannerText(parts.join(" · "), 64),
    localMeta: {
      area: truncateBannerText(opts.areaLabel, 22),
      updated: opts.fetchedAtMs != null ? formatForecastUpdatedShort(opts.fetchedAtMs) : null,
    },
  };
}
