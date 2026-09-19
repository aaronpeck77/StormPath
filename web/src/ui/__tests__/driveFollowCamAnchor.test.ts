import { describe, expect, it } from "vitest";
import {
  canPreShiftYardLineCenter,
  centerForPuckScreenAnchor,
  yardLineCenterAfterHardFollow,
  yardLineShiftLngLat,
} from "../driveFollowCamAnchor";

/**
 * Fake projection: 1 degree = 100 px, y inverted like a screen. Enough to prove the
 * shift direction, which is the part that decides whether the puck climbs.
 */
const project = (ll: [number, number]) => ({ x: ll[0] * 100, y: -ll[1] * 100 });
const unproject = (pt: [number, number]) => ({ lng: pt[0] / 100, lat: -pt[1] / 100 });

describe("centerForPuckScreenAnchor", () => {
  it("shifts the center so a centered puck drops back to the yard line", () => {
    /* Puck and center coincide → projects to viewport center (400, 300 here). */
    const next = centerForPuckScreenAnchor({
      project,
      unproject,
      center: [4, -3],
      puck: [4, -3],
      anchor: { x: 400, y: 400 }, // yard line sits 100 px below center
    });
    expect(next).not.toBeNull();
    /* Camera center must move "up" in screen space so the puck lands lower. */
    expect(next![1]).toBeGreaterThan(-3);
    expect(next![0]).toBeCloseTo(4, 6);
  });

  it("leaves the center alone when the puck is already on the anchor", () => {
    const center: [number, number] = [4, -3];
    const next = centerForPuckScreenAnchor({
      project,
      unproject,
      center,
      puck: center,
      anchor: { x: 400, y: 300 },
    });
    expect(next).toBe(center);
  });

  it("ignores sub-pixel drift so a parked puck cannot jitter the center", () => {
    const center: [number, number] = [4, -3];
    const next = centerForPuckScreenAnchor({
      project,
      unproject,
      center,
      puck: center,
      anchor: { x: 400.2, y: 300.2 },
    });
    expect(next).toBe(center);
  });

  it("returns null rather than a bad center when projection throws", () => {
    const next = centerForPuckScreenAnchor({
      project: () => {
        throw new Error("map mid-teardown");
      },
      unproject,
      center: [4, -3],
      puck: [4, -3],
      anchor: { x: 400, y: 400 },
    });
    expect(next).toBeNull();
  });

  it("drops a midfield puck to the 30-yard anchor after a hard setCenter", () => {
    const next = yardLineCenterAfterHardFollow({
      unproject,
      mapWidth: 800,
      mapHeight: 600,
      padding: { top: 0, bottom: 0, left: 0, right: 0 },
      offset: [0, 100],
      centerScreen: { x: 400, y: 300 },
    });
    expect(next).toEqual([4, -2]);
  });
});

describe("one-pose hard follow", () => {
  it("measures the yard-line shift as a reusable lng/lat delta", () => {
    const shift = yardLineShiftLngLat({
      unproject,
      mapWidth: 800,
      mapHeight: 600,
      padding: { top: 0, bottom: 0, left: 0, right: 0 },
      offset: [0, 100],
    });
    /* Same 100 px "up" correction as the two-step path, expressed as a delta. */
    expect(shift).not.toBeNull();
    expect(shift!.dLng).toBeCloseTo(0, 6);
    expect(shift!.dLat).toBeCloseTo(1, 6);
  });

  it("reports no shift when the anchor already is the canvas middle", () => {
    const shift = yardLineShiftLngLat({
      unproject,
      mapWidth: 800,
      mapHeight: 600,
      padding: { top: 0, bottom: 0, left: 0, right: 0 },
      offset: [0, 0],
    });
    expect(shift).toEqual({ dLng: 0, dLat: 0 });
  });

  it("pre-shifts a steady follow frame (one Mapbox write)", () => {
    expect(
      canPreShiftYardLineCenter({
        current: { zoom: 16.6, pitch: 60, bearing: 91 },
        target: { zoom: 16.6, pitch: 60, bearing: 90 },
      })
    ).toBe(true);
  });

  it("refuses to pre-shift an entry / post-freeze frame", () => {
    expect(
      canPreShiftYardLineCenter({
        current: { zoom: 8, pitch: 0, bearing: 0 },
        target: { zoom: 16.6, pitch: 60, bearing: 90 },
      })
    ).toBe(false);
    expect(
      canPreShiftYardLineCenter({
        current: null,
        target: { zoom: 16.6, pitch: 60, bearing: 90 },
      })
    ).toBe(false);
  });

  it("treats bearing wrap as close, not as a 359 degree jump", () => {
    expect(
      canPreShiftYardLineCenter({
        current: { zoom: 16.6, pitch: 60, bearing: 359.5 },
        target: { zoom: 16.6, pitch: 60, bearing: 0.5 },
      })
    ).toBe(true);
  });
});
