import { describe, expect, it } from "vitest";
import type { TripStop } from "../routeWaypoints";
import type { LngLat } from "../types";

/** Mirrors coordinate assembly in useNativeNavSession (keep in sync). */
function buildCoordinateList(c: {
  userLngLat: LngLat | null;
  viaStops: TripStop[];
  destLngLat: LngLat | null;
}): { lng: number; lat: number }[] | null {
  if (!c.userLngLat || !c.destLngLat) return null;
  const out: { lng: number; lat: number }[] = [
    { lng: c.userLngLat[0], lat: c.userLngLat[1] },
  ];
  for (const stop of c.viaStops) {
    const v = stop?.lngLat;
    if (!v || v.length < 2) continue;
    out.push({ lng: v[0], lat: v[1] });
  }
  out.push({ lng: c.destLngLat[0], lat: c.destLngLat[1] });
  return out.length >= 2 ? out : null;
}

describe("native nav coordinate list", () => {
  it("builds origin → via → dest", () => {
    const list = buildCoordinateList({
      userLngLat: [-88.9, 39.8],
      viaStops: [{ lngLat: [-88.5, 40.0], label: "Via" }],
      destLngLat: [-87.6, 41.8],
    });
    expect(list).toEqual([
      { lng: -88.9, lat: 39.8 },
      { lng: -88.5, lat: 40.0 },
      { lng: -87.6, lat: 41.8 },
    ]);
  });

  it("returns null without origin or dest", () => {
    expect(
      buildCoordinateList({
        userLngLat: null,
        viaStops: [],
        destLngLat: [-87.6, 41.8],
      })
    ).toBeNull();
  });
});
