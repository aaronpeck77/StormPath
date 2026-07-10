import { describe, expect, it } from "vitest";
import {
  FORECAST_REVERSE_GEOCODE_MIN_INTERVAL_MS,
  FORECAST_REVERSE_GEOCODE_MIN_MOVE_M,
  shouldRefreshForecastReverseGeocode,
} from "../forecastReverseGeocodeGate";
import type { LngLat } from "../../nav/types";

const a: LngLat = [-90.2, 38.63];
/** ~1.1 km east of `a`. */
const b: LngLat = [-90.187, 38.63];

describe("shouldRefreshForecastReverseGeocode", () => {
  it("allows the first fetch with no prior sample", () => {
    expect(
      shouldRefreshForecastReverseGeocode({
        next: a,
        lastLngLat: null,
        lastFetchedAtMs: null,
        nowMs: 1_000,
      })
    ).toBe(true);
  });

  it("blocks tiny GPS jitter under the move threshold", () => {
    const near: LngLat = [-90.1995, 38.6301];
    expect(
      shouldRefreshForecastReverseGeocode({
        next: near,
        lastLngLat: a,
        lastFetchedAtMs: 1_000,
        nowMs: 1_000 + FORECAST_REVERSE_GEOCODE_MIN_INTERVAL_MS + 1,
      })
    ).toBe(false);
  });

  it("blocks large moves until the min interval elapses", () => {
    expect(
      shouldRefreshForecastReverseGeocode({
        next: b,
        lastLngLat: a,
        lastFetchedAtMs: 1_000,
        nowMs: 1_000 + FORECAST_REVERSE_GEOCODE_MIN_INTERVAL_MS - 1,
      })
    ).toBe(false);
  });

  it("allows refresh after enough move and enough time", () => {
    expect(
      shouldRefreshForecastReverseGeocode({
        next: b,
        lastLngLat: a,
        lastFetchedAtMs: 1_000,
        nowMs: 1_000 + FORECAST_REVERSE_GEOCODE_MIN_INTERVAL_MS,
      })
    ).toBe(true);
    expect(FORECAST_REVERSE_GEOCODE_MIN_MOVE_M).toBeGreaterThan(500);
  });
});
