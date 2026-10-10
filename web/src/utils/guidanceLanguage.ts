/** About choice. "system" follows the phone. "en" forces English voice, search, and weather phrases. */
export type GuidanceLanguagePref = "system" | "en";

const MAPBOX_LANGUAGE = new Set([
  "en", "es", "fr", "de", "it", "pt", "nl", "pl", "sv", "da", "fi", "nb", "nn",
  "cs", "hu", "ro", "sk", "sl", "hr", "uk", "ru", "tr", "el", "ar", "he", "zh",
  "ja", "ko", "vi", "th", "id", "ms", "ca", "bg", "et", "lv", "lt", "sr", "is",
]);

/**
 * Short language code for Mapbox voice, search, and WeatherKit phrases.
 * The buttons stay English. An unsupported phone language stays English too.
 */
export function resolveGuidanceLanguage(
  pref: GuidanceLanguagePref,
  navigatorLanguage?: string | null
): string {
  if (pref === "en") return "en";
  const raw =
    navigatorLanguage ??
    (typeof navigator !== "undefined" ? navigator.language : "en");
  const base = (raw || "en").split("-")[0]?.toLowerCase() || "en";
  return MAPBOX_LANGUAGE.has(base) ? base : "en";
}

/** WeatherKit path segment. English stays the US tag the forecasts already use. */
export function weatherKitLanguageTag(code: string): string {
  if (!code || code === "en") return "en-US";
  return code;
}
