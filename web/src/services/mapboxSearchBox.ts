import type { LngLat } from "../nav/types";
import { fetchWithTimeout, MAPBOX_GEOCODE_TIMEOUT_MS } from "../utils/fetchResilient";

/**
 * Mapbox Search Box API client — purpose-built for business / POI autocomplete with much deeper
 * local coverage than Geocoding v5. Two-step flow:
 *
 *   1. /suggest:  as-you-type list of matches by name/category (no coordinates yet — cheap call).
 *   2. /retrieve: when the user picks a suggestion, look up its full feature (lng/lat + address).
 *
 * The pair is billed as one transaction when both calls share a `session_token` UUID, so we mint
 * one token at the start of a typing session and reuse it across keystrokes + the final retrieve.
 *
 * https://docs.mapbox.com/api/search/search-box/
 */

export type SearchBoxSuggestion = {
  /** Opaque id passed to /retrieve to fetch the full feature. */
  mapboxId: string;
  /** Primary display label — e.g. "Rural King" or "Joe's Pizza". */
  name: string;
  /** Secondary line — typically the full street address ("123 Main St, Decatur, IL 62526"). */
  placeFormatted: string;
  /** poi | address | place | locality | neighborhood | etc. */
  featureType: string;
  /** Distance from the proximity bias (meters), when SB returns it. */
  distanceMeters: number | null;
};

export type SearchBoxRetrieved = {
  lngLat: LngLat;
  /** Combined "name, full address" used as the destination label downstream. */
  placeName: string;
  /** Bare name when we want it without the address tail. */
  name: string;
};

const SUGGEST_URL = "https://api.mapbox.com/search/searchbox/v1/suggest";
const RETRIEVE_URL = "https://api.mapbox.com/search/searchbox/v1/retrieve/";

/* Categories returned in /suggest responses we care about. POI is the main reason to use Search
 * Box; we keep address + place + neighborhood for cases where the user types a street/city.
 * `locality` is included so big cities still appear in the dropdown. */
const DEFAULT_TYPES = "poi,address,place,locality,neighborhood,street";

/** Mint a new session UUID. Caller stores this in a ref and reuses it across keystrokes. */
export function mintSearchBoxSessionToken(): string {
  /* Prefer crypto.randomUUID where available (modern browsers + iOS Safari ≥ 15.4); fall back
   * to a hand-rolled v4 UUID for older webviews so TestFlight on older iPads keeps working. */
  const c =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : null;
  if (c) return c;
  const buf = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(buf);
  } else {
    for (let i = 0; i < 16; i += 1) buf[i] = Math.floor(Math.random() * 256);
  }
  /* RFC 4122 v4 fixed bits. */
  buf[6] = (buf[6]! & 0x0f) | 0x40;
  buf[8] = (buf[8]! & 0x3f) | 0x80;
  const hex = Array.from(buf, (b) => b.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}

type RawSuggestion = {
  name?: string;
  mapbox_id?: string;
  feature_type?: string;
  place_formatted?: string;
  full_address?: string;
  address?: string;
  distance?: number;
};

type RawSuggestResponse = {
  suggestions?: RawSuggestion[];
};

type RawRetrievedFeature = {
  type?: "Feature";
  geometry?: { type?: "Point"; coordinates?: [number, number] };
  properties?: {
    name?: string;
    full_address?: string;
    place_formatted?: string;
    address?: string;
  };
};

type RawRetrieveResponse = {
  type?: "FeatureCollection";
  features?: RawRetrievedFeature[];
};

/**
 * As-you-type suggestions. Returns up to `limit` results, biased toward `proximity` and scoped
 * to `countries` (ISO 3166-1 alpha-2). Empty array on any network/API failure — call sites can
 * fall back to the geocoder.
 */
export async function mapboxSearchBoxSuggest(
  query: string,
  accessToken: string,
  sessionToken: string,
  opts?: {
    proximity?: LngLat;
    countries?: readonly string[];
    limit?: number;
    types?: string;
    /** Comma-separated category codes (e.g. "restaurant,coffee"). Optional — usually omit. */
    poiCategory?: string;
  }
): Promise<SearchBoxSuggestion[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const url = new URL(SUGGEST_URL);
  url.searchParams.set("q", q);
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("session_token", sessionToken);
  url.searchParams.set("language", "en");
  url.searchParams.set("limit", String(Math.min(10, Math.max(1, opts?.limit ?? 8))));
  url.searchParams.set("types", opts?.types ?? DEFAULT_TYPES);
  if (opts?.proximity) {
    const [plng, plat] = opts.proximity;
    url.searchParams.set("proximity", `${plng},${plat}`);
  }
  if (opts?.countries && opts.countries.length > 0) {
    url.searchParams.set("country", opts.countries.join(","));
  }
  if (opts?.poiCategory) url.searchParams.set("poi_category", opts.poiCategory);

  let res: Response;
  try {
    res = await fetchWithTimeout({
      input: url.toString(),
      init: { method: "GET" },
      timeoutMs: MAPBOX_GEOCODE_TIMEOUT_MS,
    });
  } catch {
    return [];
  }
  if (!res.ok) return [];

  let body: RawSuggestResponse;
  try {
    body = (await res.json()) as RawSuggestResponse;
  } catch {
    return [];
  }
  const list = body.suggestions ?? [];
  const out: SearchBoxSuggestion[] = [];
  for (const s of list) {
    if (!s?.mapbox_id || !s.name) continue;
    out.push({
      mapboxId: s.mapbox_id,
      name: s.name,
      placeFormatted: s.place_formatted ?? s.full_address ?? s.address ?? "",
      featureType: s.feature_type ?? "unknown",
      distanceMeters: typeof s.distance === "number" ? s.distance : null,
    });
  }
  /* Sort closest-first when proximity was provided. Mapbox blends name relevance into its own
   * ranking, which can put a chain store 50 mi away above a similarly-named local shop 1 mi
   * away — users typing a business name almost always want "the nearest one" first. Hits with
   * no `distance` field (rare; usually missing for non-POI types when proximity isn't set) are
   * stable-sorted to the end so they don't get scrambled.  */
  if (opts?.proximity) {
    out.sort((a, b) => {
      const da = a.distanceMeters;
      const db = b.distanceMeters;
      if (da == null && db == null) return 0;
      if (da == null) return 1;
      if (db == null) return -1;
      return da - db;
    });
  }
  return out;
}

/**
 * Resolve a suggestion's mapbox_id to its full feature (lng/lat + formatted address). Must use
 * the same session token that was passed to /suggest so Mapbox bills the autocomplete + retrieve
 * pair as a single transaction.
 */
export async function mapboxSearchBoxRetrieve(
  mapboxId: string,
  accessToken: string,
  sessionToken: string
): Promise<SearchBoxRetrieved | null> {
  if (!mapboxId) return null;
  const url = new URL(`${RETRIEVE_URL}${encodeURIComponent(mapboxId)}`);
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("session_token", sessionToken);

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

  let body: RawRetrieveResponse;
  try {
    body = (await res.json()) as RawRetrieveResponse;
  } catch {
    return null;
  }
  const feat = body.features?.[0];
  const coords = feat?.geometry?.coordinates;
  if (!feat || !coords || coords.length < 2) return null;
  const [lng, lat] = coords;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  const props = feat.properties ?? {};
  const name = props.name ?? "";
  const addr = props.full_address ?? props.place_formatted ?? props.address ?? "";
  /* "Rural King, 1234 N Main St, Decatur, IL 62526" — name + address joined with a comma so the
   * destination label downstream reads naturally as a single line. */
  const placeName = name && addr ? `${name}, ${addr}` : name || addr || "Selected place";
  return {
    lngLat: [lng, lat],
    placeName,
    name: name || addr || "Selected place",
  };
}
