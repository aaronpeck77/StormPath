type NwsFeature = GeoJSON.Feature<GeoJSON.Geometry | null, Record<string, unknown>>;

let cachedEtag: string | null = null;
let cachedFeatures: NwsFeature[] | null = null;
let cachedAtMs = 0;

export function getCachedNwsNationalFeatures(): NwsFeature[] | null {
  return cachedFeatures;
}

export function getCachedNwsNationalEtag(): string | null {
  return cachedEtag;
}

export function getCachedNwsNationalFetchedAtMs(): number {
  return cachedAtMs;
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
