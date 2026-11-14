import { getWebEnv } from "../config/env";

/**
 * DOT/WZDx coverage — which US states have a live work-zone feed.
 * The worker's `/coverage` endpoint reports jurisdictions whose feeds fetched
 * successfully in the current snapshot (coverage ≠ active events — a covered
 * state can legitimately have zero work zones right now).
 *
 * Used by the About sheet's "Road data coverage" list so users in uncovered
 * states know hazard silence means "no feed", not "clear roads" (Bill, 585 —
 * App Store audience, not just his commute).
 */

export const US_STATE_NAMES: readonly string[] = [
  "alabama", "alaska", "arizona", "arkansas", "california", "colorado",
  "connecticut", "delaware", "district of columbia", "florida", "georgia",
  "hawaii", "idaho", "illinois", "indiana", "iowa", "kansas", "kentucky",
  "louisiana", "maine", "maryland", "massachusetts", "michigan",
  "minnesota", "mississippi", "missouri", "montana", "nebraska", "nevada",
  "new hampshire", "new jersey", "new mexico", "new york",
  "north carolina", "north dakota", "ohio", "oklahoma", "oregon",
  "pennsylvania", "rhode island", "south carolina", "south dakota",
  "tennessee", "texas", "utah", "vermont", "virginia", "washington",
  "west virginia", "wisconsin", "wyoming",
];

/** Display names for the coverage list (title case). */
const STATE_DISPLAY: Record<string, string> = {
  "district of columbia": "District of Columbia",
};

export function dotStateDisplayName(key: string): string {
  return (
    STATE_DISPLAY[key] ??
    key.replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

let cached: { at: number; states: Set<string> } | null = null;
const CACHE_MS = 15 * 60_000;

/** Lowercase state names with a live feed. Empty set on failure — callers
 * should treat "unknown" as "don't show the gap list", not "nothing covered". */
export async function fetchDotCoverageStates(): Promise<Set<string>> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.states;
  const base = (getWebEnv().dotFeedUrl ?? "").replace(/\/+$/, "");
  if (!base) return new Set();
  try {
    const res = await fetch(`${base}/coverage`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return cached?.states ?? new Set();
    const data = (await res.json()) as { states?: unknown };
    const states = new Set(
      Array.isArray(data.states)
        ? data.states.filter((s): s is string => typeof s === "string").map((s) => s.trim().toLowerCase())
        : []
    );
    cached = { at: Date.now(), states };
    return states;
  } catch {
    return cached?.states ?? new Set();
  }
}

/** US states with NO live DOT feed, for the About-sheet gap list. */
export function uncoveredUsStates(covered: Set<string>): string[] {
  return US_STATE_NAMES.filter((s) => !covered.has(s));
}

/** US states WITH a live feed (for the covered portion of the list). */
export function coveredUsStates(covered: Set<string>): string[] {
  return US_STATE_NAMES.filter((s) => covered.has(s));
}

/** Partial-coverage footnotes — the feed exists but isn't statewide. */
export const DOT_COVERAGE_CAVEATS: readonly string[] = [
  "Arizona coverage is Phoenix-metro (Maricopa County) only.",
];

/** States with live plow-report winter road-condition feeds — a layer on top
 * of ordinary work-zone/incident coverage. IL/IA/MO keyless ArcGIS + MD CHART
 * winter events. Keep in sync with CUSTOM_FEEDS in cloudflare/dot-feeds. */
export const WINTER_CONDITION_STATES: readonly string[] = [
  "illinois",
  "iowa",
  "missouri",
  "maryland",
];
