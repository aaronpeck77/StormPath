import { describe, expect, it } from "vitest";
import { routeDoublesBack } from "../routeDoublesBack";
import type { LngLat } from "../types";

/** Offset meters from a fixed point. Lat 40° so the town loop is real meters. */
function at(northM: number, eastM: number): LngLat {
  const lat0 = 40;
  const lng0 = -89;
  const lat = lat0 + northM / 111_320;
  const lng = lng0 + eastM / (111_320 * Math.cos((lat0 * Math.PI) / 180));
  return [lng, lat];
}

describe("routeDoublesBack", () => {
  it("stays quiet on a straight road", () => {
    const line = [at(0, 0), at(2_000, 0), at(5_000, 40)];
    expect(routeDoublesBack(line)).toBe(false);
  });

  it("catches a right through town that returns to the same intersection", () => {
    const line = [
      at(0, 0),
      at(0, 700),
      at(700, 700),
      at(700, 0),
      at(0, 0),
      at(0, -500),
    ];
    expect(routeDoublesBack(line)).toBe(true);
  });
});
