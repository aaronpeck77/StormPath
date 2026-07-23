import { afterEach, describe, expect, it } from "vitest";
import {
  clearReverseGeocodeCacheForTests,
  getCachedReverseGeocode,
  reverseGeocodeCellKey,
  setCachedReverseGeocode,
} from "../reverseGeocodeCache";

describe("reverseGeocodeCache", () => {
  afterEach(() => {
    clearReverseGeocodeCacheForTests();
  });

  it("uses the same cell key for nearby coordinates", () => {
    const a = reverseGeocodeCellKey(-87.63, 41.88);
    const b = reverseGeocodeCellKey(-87.6305, 41.8804);
    expect(a).toBe(b);
  });

  it("returns cached hits inside TTL and misses after expiry", () => {
    const t0 = 1_000_000;
    setCachedReverseGeocode(-87.63, 41.88, {
      lngLat: [-87.63, 41.88],
      placeName: "Chicago, IL",
    }, t0);
    expect(getCachedReverseGeocode(-87.6302, 41.8801, t0 + 1_000)?.placeName).toBe(
      "Chicago, IL"
    );
    expect(getCachedReverseGeocode(-87.63, 41.88, t0 + 25 * 60 * 60 * 1000)).toBeUndefined();
  });
});
