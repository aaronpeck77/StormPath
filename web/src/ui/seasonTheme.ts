/**
 * Seasonal theming for the home-screen idle branding strip.
 *
 * Drives the seasonal cloud illustration (rain vs snow vs accent precipitation) and the
 * "Storm/Path" wordmark gradient via a single resolved {@link Season} value.
 *
 * Resolution order:
 *   1. URL search param `?season=winter|spring|summer|fall` — testing override so the
 *      seasonal art can be previewed regardless of today's date.
 *   2. Meteorological calendar in the user's local timezone (Northern Hemisphere):
 *        - Winter: Dec 1 – Feb 28/29
 *        - Spring: Mar 1 – May 31
 *        - Summer: Jun 1 – Aug 31
 *        - Fall:   Sep 1 – Nov 30
 *      The vast majority of users live in the Northern Hemisphere, so we anchor to NH
 *      conventions; the URL override gives Southern-Hemisphere users (or anyone who
 *      prefers a different vibe) a way to choose.
 */

export type Season = "winter" | "spring" | "summer" | "fall";

const VALID = new Set<Season>(["winter", "spring", "summer", "fall"]);

function readUrlOverride(): Season | null {
  if (typeof window === "undefined") return null;
  try {
    const sp = new URLSearchParams(window.location.search);
    const raw = (sp.get("season") ?? "").toLowerCase().trim();
    /* "autumn" is a friendly alias for "fall" since both are common spellings. */
    const normalized = raw === "autumn" ? "fall" : raw;
    if (VALID.has(normalized as Season)) return normalized as Season;
  } catch {
    /* swallow malformed URLs — defaults to date-based detection */
  }
  return null;
}

/**
 * Northern-Hemisphere meteorological season for the given date in the user's local time.
 * Pure function for testability; consumers should call {@link getCurrentSeason} instead so
 * they pick up the URL override.
 */
export function seasonFromDate(d: Date): Season {
  const m = d.getMonth(); // 0 = Jan
  if (m === 11 || m === 0 || m === 1) return "winter";
  if (m >= 2 && m <= 4) return "spring";
  if (m >= 5 && m <= 7) return "summer";
  return "fall";
}

/**
 * Resolve the current season for theming purposes — URL override wins, otherwise
 * meteorological calendar from "right now".
 */
export function getCurrentSeason(now: Date = new Date()): Season {
  return readUrlOverride() ?? seasonFromDate(now);
}
