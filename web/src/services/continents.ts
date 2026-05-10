import type { LngLat } from "../nav/types";

/**
 * Coarse continent classifier used to scope geocoder results to "your part of the world".
 *
 * The user opened the address bar to global coverage but doesn't want London / Moscow / Sydney
 * showing up when they type "Springfield" from Illinois — search results should only include
 * countries on the same continent as the user's current GPS fix.
 *
 * Implementation is intentionally offline (no extra reverse-geocode network round-trip): a small
 * set of lng/lat bounding boxes maps the user's coordinate to one of six continents, and a static
 * lookup converts that continent into the ISO 3166-1 alpha-2 country list passed to Mapbox via
 * the `country=` query parameter.
 *
 * Edge cases (Russia / Turkey straddling Europe + Asia, Egypt straddling Africa + Asia, Hawaii
 * sitting in Oceania-adjacent Pacific) are handled by allowing the boundary countries to appear
 * in the country lists for both candidate continents.
 */

export type ContinentCode = "NA" | "SA" | "EU" | "AF" | "AS" | "OC";

/**
 * Classify a coordinate into a continent. Falls back to `null` for the (very small) ocean cells
 * outside any bounding box — caller treats `null` as "no filter, search the whole world".
 *
 * Order matters: North America before South America (Caribbean overlap), Europe before Africa
 * (Mediterranean overlap), Europe before Asia (Turkey / Caucasus overlap).
 */
export function continentFromLngLat(lngLat: LngLat | null | undefined): ContinentCode | null {
  if (!lngLat) return null;
  const [lng, lat] = lngLat;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;

  /* North America: continental US, Canada, Mexico, Central America, Caribbean, Greenland.
   * Spans -168°W (Aleutians) to -52°W (eastern Greenland), 7°N (Panama) to 84°N (northern Greenland). */
  if (lng >= -168 && lng <= -52 && lat >= 7 && lat <= 84) return "NA";

  /* South America: ≈ -82°W to -34°W, -56°S (Cape Horn) to 13°N (northern Venezuela). */
  if (lng >= -82 && lng <= -34 && lat >= -56 && lat < 13) return "SA";

  /* Europe (incl. Iceland, Russia west of Urals, Turkey via boundary): -25°W to 60°E, 35°N to 72°N. */
  if (lng >= -25 && lng <= 60 && lat >= 35 && lat <= 72) return "EU";

  /* Africa: -18°W (Cape Verde) to 52°E (Horn of Africa), -35°S (Cape Town) to 38°N (Tunisia). */
  if (lng >= -18 && lng <= 52 && lat >= -35 && lat < 35) return "AF";

  /* Oceania western half: Australia / NZ / Melanesia / Micronesia. */
  if (lng >= 110 && lng <= 180 && lat >= -50 && lat <= 5) return "OC";
  /* Oceania eastern half (Pacific antimeridian wrap): French Polynesia, Hawaii, Samoa. */
  if (lng >= -180 && lng <= -130 && lat >= -30 && lat <= 30) return "OC";

  /* Asia: catch-all east-of-Europe — 26°E to 180°E, -11°S (eastern Indonesia) to 78°N (Siberia).
   * Comes last so Europe / Africa / Oceania bounds win for overlapping coordinates above. */
  if (lng >= 26 && lng <= 180 && lat >= -11 && lat <= 78) return "AS";

  return null;
}

/**
 * ISO 3166-1 alpha-2 country lists per continent. Lower-case to match Mapbox's `country=` format.
 *
 * Russia + Turkey appear in both EU and AS so users at the boundary still get coverage on their
 * "home" side. Egypt appears in AF only (queries near Cairo will still surface via proximity bias).
 *
 * Mapbox accepts arbitrary length comma-separated country lists; URL length stays well under the
 * ~8 KB practical limit even for AF / AS which carry ~50 codes each.
 */
const COUNTRIES_BY_CONTINENT: Readonly<Record<ContinentCode, readonly string[]>> = {
  NA: [
    "us", "ca", "mx", "gt", "bz", "sv", "hn", "ni", "cr", "pa",
    "cu", "ht", "do", "jm", "bs", "tt", "bb", "ag", "dm", "gd",
    "kn", "lc", "vc", "gl", "pr", "vi", "ai", "aw", "bm", "vg",
    "ky", "gp", "mq", "ms", "sx", "tc", "bq", "cw",
  ],
  SA: ["ar", "bo", "br", "cl", "co", "ec", "fk", "gf", "gy", "py", "pe", "sr", "uy", "ve"],
  EU: [
    "al", "ad", "at", "ba", "be", "bg", "by", "ch", "cy", "cz",
    "de", "dk", "ee", "es", "fi", "fo", "fr", "gb", "ge", "gg",
    "gi", "gr", "hr", "hu", "ie", "im", "is", "it", "je", "li",
    "lt", "lu", "lv", "mc", "md", "me", "mk", "mt", "nl", "no",
    "pl", "pt", "ro", "rs", "ru", "se", "si", "sk", "sm", "tr",
    "ua", "va", "xk",
  ],
  AF: [
    "ao", "bf", "bi", "bj", "bw", "cd", "cf", "cg", "ci", "cm",
    "cv", "dj", "dz", "eg", "eh", "er", "et", "ga", "gh", "gm",
    "gn", "gq", "gw", "ke", "km", "lr", "ls", "ly", "ma", "mg",
    "ml", "mr", "mu", "mw", "mz", "na", "ne", "ng", "rw", "sc",
    "sd", "sl", "sn", "so", "ss", "st", "sz", "td", "tg", "tn",
    "tz", "ug", "za", "zm", "zw",
  ],
  AS: [
    "af", "ae", "am", "az", "bd", "bh", "bn", "bt", "cn", "hk",
    "id", "il", "in", "iq", "ir", "jo", "jp", "kg", "kh", "kp",
    "kr", "kw", "kz", "la", "lb", "lk", "mm", "mn", "mo", "mv",
    "my", "np", "om", "ph", "pk", "ps", "qa", "ru", "sa", "sg",
    "sy", "th", "tj", "tl", "tm", "tr", "tw", "uz", "vn", "ye",
  ],
  OC: [
    "as", "au", "ck", "fj", "fm", "gu", "ki", "mh", "mp", "nc",
    "nf", "nr", "nu", "nz", "pf", "pg", "pn", "pw", "sb", "tk",
    "to", "tv", "vu", "ws", "wf",
  ],
};

/**
 * Returns the country code list to scope a Mapbox geocoder query to. `null` means "no filter"
 * (couldn't determine the user's continent — e.g. ocean cell or no GPS yet).
 */
export function countriesForContinent(code: ContinentCode | null): readonly string[] | null {
  if (!code) return null;
  return COUNTRIES_BY_CONTINENT[code];
}

/** Convenience wrapper: classify a fix and return its country filter list (or null). */
export function geocodeCountriesForFix(lngLat: LngLat | null | undefined): readonly string[] | null {
  return countriesForContinent(continentFromLngLat(lngLat));
}
