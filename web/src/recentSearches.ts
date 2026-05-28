import type { LngLat } from "./nav/types";
import { safeStorage } from "./storage/safeStorage";
import type { SearchSuggestion } from "./ui/SearchBar";

const RECENT_KEY = "stormpath-recent-searches-v1";
const MAX_RECENTS = 2;

type RecentEntry = {
  placeName: string;
  lngLat: LngLat;
  savedAtMs: number;
};

function safeRead(): RecentEntry[] {
  const parsed = safeStorage.getJson<unknown>(RECENT_KEY, []);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((x) => x as Partial<RecentEntry>)
    .filter(
      (x): x is RecentEntry =>
        typeof x?.placeName === "string" &&
        Array.isArray(x?.lngLat) &&
        x.lngLat.length === 2 &&
        typeof x.lngLat[0] === "number" &&
        typeof x.lngLat[1] === "number" &&
        typeof x.savedAtMs === "number"
    )
    .sort((a, b) => b.savedAtMs - a.savedAtMs);
}

function safeWrite(entries: RecentEntry[]): void {
  safeStorage.setJson(RECENT_KEY, entries.slice(0, MAX_RECENTS));
}

function hitId(placeName: string, lngLat: LngLat): string {
  const [lng, lat] = lngLat;
  // Keep it stable so we can dedupe by coarse coordinates + label.
  return `${placeName}@@${lng.toFixed(4)},${lat.toFixed(4)}`;
}

export function loadRecentSearchSuggestions(): SearchSuggestion[] {
  const recents = safeRead().slice(0, MAX_RECENTS);
  return recents.map((r) => ({
    id: hitId(r.placeName, r.lngLat),
    placeName: r.placeName,
    lngLat: r.lngLat,
  }));
}

export function recordRecentSearch(placeName: string, lngLat: LngLat): void {
  try {
    const recents = safeRead();
    const next: RecentEntry[] = [
      { placeName, lngLat, savedAtMs: Date.now() },
      ...recents.filter((r) => hitId(r.placeName, r.lngLat) !== hitId(placeName, lngLat)),
    ];
    safeWrite(next);
  } catch {
    /* ignore */
  }
}

