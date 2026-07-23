import type { LngLat } from "../nav/types";
import { fetchWithTimeout, MAPBOX_GEOCODE_TIMEOUT_MS } from "../utils/fetchResilient";
import { getCachedReverseGeocode, setCachedReverseGeocode } from "./reverseGeocodeCache";

export type GeocodeHit = { lngLat: LngLat; placeName: string };

export type AutocompleteHit = {
  id: string;
  /* For Search Box suggestions, this is a placeholder until /retrieve resolves. Geocoder hits
   * always have real coords here. Use `mapboxId` presence to detect the deferred case. */
  lngLat: LngLat;
  placeName: string;
  /** Secondary line — e.g. "1234 N Main St, Decatur, IL 62526" shown under the business name. */
  secondary?: string;
  /** Mapbox Search Box id; when set, the picker MUST call /retrieve before using `lngLat`. */
  mapboxId?: string;
  /** poi | address | place | locality | neighborhood | street | unknown — drives the row icon. */
  featureType?: string;
};


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
    /* ISO 3166-1 alpha-2 country codes — when set, Mapbox restricts results to these countries.
     * We pass the user's continent country list so a search in Illinois can't surface London/Moscow. */
    countries?: readonly string[];
  }
) {
  url.searchParams.set("access_token", accessToken);
  if (opts.autocomplete) url.searchParams.set("autocomplete", "true");
  url.searchParams.set("types", opts.types);
  url.searchParams.set("limit", String(opts.limit));
  if (opts.proximity) {
    const [plng, plat] = opts.proximity;
    url.searchParams.set("proximity", `${plng},${plat}`);
  }
  if (opts.countries && opts.countries.length > 0) {
    url.searchParams.set("country", opts.countries.join(","));
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
    countries?: readonly string[];
  }
): Promise<MbxFeature[]> {
  const url = buildPlacesUrl(q);
  addForwardCommon(url, accessToken, opts);
  try {
    const res = await fetchWithTimeout({
      input: url.toString(),
      init: { method: "GET" },
      timeoutMs: MAPBOX_GEOCODE_TIMEOUT_MS,
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { features?: MbxFeature[] };
    return data.features ?? [];
  } catch {
    return [];
  }
}

/** Single forward request (city-only searches stay one call). */
async function broadForwardFeatures(
  q: string,
  accessToken: string,
  opts: { autocomplete?: boolean; limit: number; proximity?: LngLat; countries?: readonly string[] }
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
  opts: { autocomplete?: boolean; limit: number; proximity?: LngLat; countries?: readonly string[] }
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
  opts: { autocomplete?: boolean; limit: number; proximity?: LngLat; countries?: readonly string[] }
): Promise<MbxFeature[]> {
  const words = q.trim().split(/\s+/).filter(Boolean);
  /* Two requests only when the query looks like a business + place (saves quota on "Chicago"-only). */
  if (words.length >= 2) return mergedForwardFeatures(q, accessToken, opts);
  return broadForwardFeatures(q, accessToken, opts);
}

function featureToAutocompleteHit(f: MbxFeature, q: string): AutocompleteHit | null {
  if (!f.center || !f.id) return null;
  const [lng, lat] = f.center;
  void lat; // used implicitly via destructuring
  return {
    id: f.id,
    lngLat: [lng, lat],
    placeName: f.place_name ?? q,
  };
}

export async function mapboxForwardGeocode(
  query: string,
  accessToken: string,
  opts?: { proximity?: LngLat; countries?: readonly string[] }
): Promise<GeocodeHit | null> {
  const q = query.trim();
  if (!q) return null;

  const features = await forwardFeaturesForQuery(q, accessToken, {
    limit: 5,
    proximity: opts?.proximity,
    countries: opts?.countries,
  });

  for (const f of features) {
    if (!f.center) continue;
    const [lng, lat] = f.center;
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
  opts?: { proximity?: LngLat; limit?: number; countries?: readonly string[] }
): Promise<AutocompleteHit[]> {
  const q = query.trim();
  if (!q) return [];
  const limit = Math.min(15, Math.max(1, opts?.limit ?? 12));
  const features = await forwardFeaturesForQuery(q, accessToken, {
    autocomplete: false,
    limit,
    proximity: opts?.proximity,
    countries: opts?.countries,
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
  proximity?: LngLat,
  countries?: readonly string[]
): Promise<AutocompleteHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const features = await forwardFeaturesForQuery(q, accessToken, {
    autocomplete: true,
    limit,
    proximity,
    countries,
  });

  const out: AutocompleteHit[] = [];
  for (const f of features) {
    const hit = featureToAutocompleteHit(f, q);
    if (hit) out.push(hit);
    if (out.length >= limit) break;
  }
  return out;
}

/** Reverse geocode a dropped pin. Cell-cached to cut Temporary Geocoding bill. */
export async function mapboxReverseGeocode(
  lng: number,
  lat: number,
  accessToken: string
): Promise<GeocodeHit | null> {
  const cached = getCachedReverseGeocode(lng, lat);
  if (cached !== undefined) return cached;

  const url = new URL(
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(`${lng},${lat}`)}.json`
  );
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("limit", "1");

  let res: Response;
  try {
    res = await fetchWithTimeout({
      input: url.toString(),
      init: { method: "GET" },
      timeoutMs: MAPBOX_GEOCODE_TIMEOUT_MS,
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const data = (await res.json()) as {
    features?: { center: [number, number]; place_name?: string }[];
  };
  const f = data.features?.[0];
  if (!f?.center) {
    setCachedReverseGeocode(lng, lat, null);
    return null;
  }
  const [flng, flat] = f.center;
  const hit: GeocodeHit = {
    lngLat: [flng, flat],
    placeName: f.place_name ?? `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
  };
  setCachedReverseGeocode(lng, lat, hit);
  return hit;
}
