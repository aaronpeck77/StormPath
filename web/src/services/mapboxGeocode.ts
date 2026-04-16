import { lngLatInNorthAmerica, NORTH_AMERICA_BOUNDS } from "../config/mapRegion";
import type { LngLat } from "../nav/types";

export type GeocodeHit = { lngLat: LngLat; placeName: string };

export type AutocompleteHit = { id: string; lngLat: LngLat; placeName: string };

const GEOCODE_COUNTRIES = "us,ca";

type MbxFeature = {
  id: string;
  center: [number, number];
  place_name?: string;
  place_type?: string[];
};

function buildPlacesUrl(q: string): URL {
  return new URL(
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json`
  );
}

function addForwardCommon(
  url: URL,
  accessToken: string,
  opts: {
    autocomplete?: boolean;
    types: string;
    limit: number;
    proximity?: LngLat;
  }
) {
  url.searchParams.set("access_token", accessToken);
  if (opts.autocomplete) url.searchParams.set("autocomplete", "true");
  url.searchParams.set("types", opts.types);
  url.searchParams.set("limit", String(opts.limit));
  url.searchParams.set("country", GEOCODE_COUNTRIES);
  const [w, s] = NORTH_AMERICA_BOUNDS[0];
  const [e, n] = NORTH_AMERICA_BOUNDS[1];
  url.searchParams.set("bbox", `${w},${s},${e},${n}`);
  if (opts.proximity) {
    const [plng, plat] = opts.proximity;
    url.searchParams.set("proximity", `${plng},${plat}`);
  }
}

async function fetchForwardFeatures(
  q: string,
  accessToken: string,
  opts: {
    autocomplete?: boolean;
    types: string;
    limit: number;
    proximity?: LngLat;
  }
): Promise<MbxFeature[]> {
  const url = buildPlacesUrl(q);
  addForwardCommon(url, accessToken, opts);
  const res = await fetch(url.toString());
  if (!res.ok) return [];
  const data = (await res.json()) as { features?: MbxFeature[] };
  return data.features ?? [];
}

/** Single forward request (city-only searches stay one call). */
async function broadForwardFeatures(
  q: string,
  accessToken: string,
  opts: { autocomplete?: boolean; limit: number; proximity?: LngLat }
): Promise<MbxFeature[]> {
  return fetchForwardFeatures(q, accessToken, {
    ...opts,
    types: "address,poi,place,locality,neighborhood",
    limit: Math.min(25, opts.limit + 10),
  });
}

/**
 * Mapbox often ranks `place` (e.g. "Decatur, Illinois") above `poi` for queries like
 * "Rural King Decatur IL". We merge a POI-only request first, then addresses/cities.
 */
async function mergedForwardFeatures(
  q: string,
  accessToken: string,
  opts: { autocomplete?: boolean; limit: number; proximity?: LngLat }
): Promise<MbxFeature[]> {
  const lim = Math.max(opts.limit, 5);
  const fetchLimit = Math.min(25, lim + 12);
  const [poiFeats, restFeats] = await Promise.all([
    fetchForwardFeatures(q, accessToken, {
      ...opts,
      types: "poi",
      limit: fetchLimit,
    }),
    fetchForwardFeatures(q, accessToken, {
      ...opts,
      types: "address,place,locality,neighborhood",
      limit: fetchLimit,
    }),
  ]);

  const seen = new Set<string>();
  const out: MbxFeature[] = [];

  for (const f of poiFeats) {
    if (!f?.id || !f.center) continue;
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    out.push(f);
  }
  for (const f of restFeats) {
    if (!f?.id || !f.center) continue;
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    out.push(f);
  }

  return out;
}

async function forwardFeaturesForQuery(
  q: string,
  accessToken: string,
  opts: { autocomplete?: boolean; limit: number; proximity?: LngLat }
): Promise<MbxFeature[]> {
  const words = q.trim().split(/\s+/).filter(Boolean);
  /* Two requests only when the query looks like a business + place (saves quota on "Chicago"-only). */
  if (words.length >= 2) return mergedForwardFeatures(q, accessToken, opts);
  return broadForwardFeatures(q, accessToken, opts);
}

function featureToAutocompleteHit(f: MbxFeature, q: string): AutocompleteHit | null {
  if (!f.center || !f.id) return null;
  const [lng, lat] = f.center;
  if (!lngLatInNorthAmerica(lng, lat)) return null;
  return {
    id: f.id,
    lngLat: [lng, lat],
    placeName: f.place_name ?? q,
  };
}

export async function mapboxForwardGeocode(
  query: string,
  accessToken: string,
  opts?: { proximity?: LngLat }
): Promise<GeocodeHit | null> {
  const q = query.trim();
  if (!q) return null;

  const features = await forwardFeaturesForQuery(q, accessToken, {
    limit: 5,
    proximity: opts?.proximity,
  });

  for (const f of features) {
    if (!f.center) continue;
    const [lng, lat] = f.center;
    if (!lngLatInNorthAmerica(lng, lat)) continue;
    return {
      lngLat: [lng, lat],
      placeName: f.place_name ?? q,
    };
  }
  return null;
}

/**
 * Full-query geocode (Enter): several hits for map pins + disambiguation. Geocoding v5 only.
 */
export async function mapboxGeocodeSearch(
  query: string,
  accessToken: string,
  opts?: { proximity?: LngLat; limit?: number }
): Promise<AutocompleteHit[]> {
  const q = query.trim();
  if (!q) return [];
  const limit = Math.min(15, Math.max(1, opts?.limit ?? 12));
  const features = await forwardFeaturesForQuery(q, accessToken, {
    autocomplete: false,
    limit,
    proximity: opts?.proximity,
  });
  const out: AutocompleteHit[] = [];
  const seenCoord = new Set<string>();
  for (const f of features) {
    const hit = featureToAutocompleteHit(f, q);
    if (!hit) continue;
    const key = `${hit.lngLat[0].toFixed(5)},${hit.lngLat[1].toFixed(5)}`;
    if (seenCoord.has(key)) continue;
    seenCoord.add(key);
    out.push(hit);
    if (out.length >= limit) break;
  }
  return out;
}

/** As-you-type suggestions (Mapbox Geocoding autocomplete). */
export async function mapboxAutocomplete(
  query: string,
  accessToken: string,
  limit = 5,
  proximity?: LngLat
): Promise<AutocompleteHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const features = await forwardFeaturesForQuery(q, accessToken, {
    autocomplete: true,
    limit,
    proximity,
  });

  const out: AutocompleteHit[] = [];
  for (const f of features) {
    const hit = featureToAutocompleteHit(f, q);
    if (hit) out.push(hit);
    if (out.length >= limit) break;
  }
  return out;
}

/** Reverse geocode a dropped pin (US & Canada). */
export async function mapboxReverseGeocode(
  lng: number,
  lat: number,
  accessToken: string
): Promise<GeocodeHit | null> {
  if (!lngLatInNorthAmerica(lng, lat)) return null;

  const url = new URL(
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(`${lng},${lat}`)}.json`
  );
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("limit", "1");
  url.searchParams.set("country", GEOCODE_COUNTRIES);

  const res = await fetch(url.toString());
  if (!res.ok) return null;
  const data = (await res.json()) as {
    features?: { center: [number, number]; place_name?: string }[];
  };
  const f = data.features?.[0];
  if (!f?.center) return null;
  const [flng, flat] = f.center;
  if (!lngLatInNorthAmerica(flng, flat)) return null;
  return {
    lngLat: [flng, flat],
    placeName: f.place_name ?? `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
  };
}
