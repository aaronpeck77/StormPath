import { describe, expect, it } from "vitest";
import { OFFLINE_CLAMP_MAX_ZOOM, offlineMaxZoom } from "../offlineZoomClamp";

describe("offlineMaxZoom", () => {
  it("returns the normal max zoom while online with no radio hold", () => {
    expect(offlineMaxZoom({ isOnline: true, holdLastGoodMap: false, normalMaxZoom: 22 })).toBe(22);
  });

  it("clamps to 13.9 while offline", () => {
    expect(offlineMaxZoom({ isOnline: false, holdLastGoodMap: false, normalMaxZoom: 22 })).toBe(
      OFFLINE_CLAMP_MAX_ZOOM
    );
  });

  it("clamps to 13.9 during a radio hold even though the radio says online", () => {
    expect(offlineMaxZoom({ isOnline: true, holdLastGoodMap: true, normalMaxZoom: 22 })).toBe(
      OFFLINE_CLAMP_MAX_ZOOM
    );
  });

  it("never raises a normal max zoom below the clamp", () => {
    expect(offlineMaxZoom({ isOnline: false, holdLastGoodMap: false, normalMaxZoom: 11 })).toBe(11);
  });
});
