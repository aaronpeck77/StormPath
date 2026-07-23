/** Shared Mapbox free-tier rails + counter math for Control Room / ops-usage. */

export type MapboxUsageCounters = {
  directions: number;
  geocoding: number;
  matching: number;
  navTrips: number;
  searchBox: number;
  mapLoads: number;
};

export type MapboxUsageDay = MapboxUsageCounters & {
  date: string;
  updatedAt: string;
};

/**
 * Published Mapbox free monthly allowances (pay-as-you-go). Nav trips = Navigation SDK trips.
 * mapLoads = GL JS "map load" (one per `Map` object init — see docs.mapbox.com/mapbox-gl-js/guides/pricing),
 * NOT a per-tile count; that's the actual unit Mapbox bills the web map on.
 */
export const MAPBOX_FREE_TIER: MapboxUsageCounters = {
  directions: 100_000,
  geocoding: 100_000,
  matching: 100_000,
  navTrips: 1_000,
  searchBox: 100_000,
  mapLoads: 50_000,
};

export const MAPBOX_USAGE_LABELS: Record<keyof MapboxUsageCounters, string> = {
  directions: "Directions",
  geocoding: "Temporary geocoding",
  matching: "Map Matching",
  navTrips: "Navigation trips",
  searchBox: "Search Box",
  mapLoads: "Map loads (Web)",
};

export function emptyMapboxUsageCounters(): MapboxUsageCounters {
  return {
    directions: 0,
    geocoding: 0,
    matching: 0,
    navTrips: 0,
    searchBox: 0,
    mapLoads: 0,
  };
}

export function addMapboxUsageCounters(
  a: MapboxUsageCounters,
  b: Partial<MapboxUsageCounters>
): MapboxUsageCounters {
  return {
    directions: Math.max(0, (a.directions || 0) + (Number(b.directions) || 0)),
    geocoding: Math.max(0, (a.geocoding || 0) + (Number(b.geocoding) || 0)),
    matching: Math.max(0, (a.matching || 0) + (Number(b.matching) || 0)),
    navTrips: Math.max(0, (a.navTrips || 0) + (Number(b.navTrips) || 0)),
    searchBox: Math.max(0, (a.searchBox || 0) + (Number(b.searchBox) || 0)),
    mapLoads: Math.max(0, (a.mapLoads || 0) + (Number(b.mapLoads) || 0)),
  };
}

export function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export function utcMonthPrefix(date = utcToday()): string {
  return date.slice(0, 7);
}

export function sumUsageDays(days: readonly MapboxUsageDay[]): MapboxUsageCounters {
  return days.reduce<MapboxUsageCounters>(
    (acc, d) => addMapboxUsageCounters(acc, d),
    emptyMapboxUsageCounters()
  );
}

export function usagePct(used: number, free: number): number {
  if (!Number.isFinite(used) || !Number.isFinite(free) || free <= 0) return 0;
  return Math.min(999, Math.round((used / free) * 100));
}

export type UsageWarnLevel = "ok" | "warn" | "bad";

export function usageWarnLevel(pct: number): UsageWarnLevel {
  if (pct >= 90) return "bad";
  if (pct >= 70) return "warn";
  return "ok";
}

export function clampUsageDeltas(
  raw: Partial<MapboxUsageCounters>,
  maxPerField = 200
): MapboxUsageCounters {
  const out = emptyMapboxUsageCounters();
  for (const key of Object.keys(out) as (keyof MapboxUsageCounters)[]) {
    const n = Math.floor(Number(raw[key]) || 0);
    if (n > 0) out[key] = Math.min(maxPerField, n);
  }
  return out;
}
