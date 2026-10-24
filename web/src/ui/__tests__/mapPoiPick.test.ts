import { describe, expect, it } from "vitest";
import { selectablePoiAtPoint } from "../mapPoiPick";
import type { Map as MapboxMap } from "mapbox-gl";

describe("selectablePoiAtPoint", () => {
  it("returns null instead of throwing when style/query blows up on a building tap", () => {
    const map = {
      getStyle: () => {
        throw new Error("3d-buildings");
      },
    } as unknown as MapboxMap;
    expect(selectablePoiAtPoint(map, [10, 10])).toBeNull();
  });
});
