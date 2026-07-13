type NwsFeature = GeoJSON.Feature<GeoJSON.Geometry | null, Record<string, unknown>>;

let cachedEtag: string | null = null;
let cachedFeatures: NwsFeature[] | null = null;
let cachedAtMs = 0;

/** Soft TTL — skip another national HTTP pull while the in-memory feed is still fresh. */
export const NWS_NATIONAL_SOFT_CACHE_MS = 90_000;

export function getCachedNwsNationalFeatures(): NwsFeature[] | null {
  return cachedFeatures;
}

export function getCachedNwsNationalEtag(): string | null {
  return cachedEtag;
}

export function getCachedNwsNationalFetchedAtMs(): number {
  return cachedAtMs;
}

/** True when the soft cache can satisfy another corridor refresh without hitting api.weather.gov. */
export function nwsNationalSoftCacheFresh(nowMs = Date.now()): boolean {
  return Boolean(cachedFeatures?.length && nowMs - cachedAtMs < NWS_NATIONAL_SOFT_CACHE_MS);
}

export function storeNwsNationalCache(etag: string | null, features: NwsFeature[]): void {
  cachedAtMs = Date.now();
  cachedFeatures = features;
  if (etag) cachedEtag = etag;
}

/** Drop in-memory national cache (e.g. after a failed refresh). */
export function clearNwsNationalCache(): void {
  cachedEtag = null;
  cachedFeatures = null;
  cachedAtMs = 0;
}
