import { describe, expect, it } from "vitest";
import {
  centerForPuckScreenAnchor,
  yardLineCenterAfterHardFollow,
  yardLineCorrectionIsSane,
  YARD_LINE_CORRECTION_MAX_M,
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

/**
 * 439 regression: a pre-computed shift assumed `setCenter` lands the center at
 * canvas middle. With landscape padding it lands at the *padded* center, so the
 * correction double-counted padding and threw the puck sideways at Go. The
 * correction must be measured from where the center actually projected.
 */
describe("yard-line correction uses the measured center, not canvas middle", () => {
  const padding = { top: 0, bottom: 0, left: 200, right: 0 };

  it("takes the real projected center into account", () => {
    /* Asymmetric padding: the anchor sits right of canvas middle. */
    const measured = yardLineCenterAfterHardFollow({
      unproject,
      mapWidth: 800,
      mapHeight: 600,
      padding,
      offset: [0, 100],
      centerScreen: { x: 500, y: 300 },
    });
    const assumedMid = yardLineCenterAfterHardFollow({
      unproject,
      mapWidth: 800,
      mapHeight: 600,
      padding,
      offset: [0, 100],
    });
    expect(measured).not.toBeNull();
    expect(assumedMid).not.toBeNull();
    /* The two disagree — which is exactly why guessing the center is not allowed. */
    expect(measured![0]).not.toBeCloseTo(assumedMid![0], 6);
  });

  it("rejects a near-horizon unproject blow-up instead of driving the camera off", () => {
    const puck: [number, number] = [-88.95, 39.84];
    /* A few hundred metres is the real yard-line correction. */
    expect(yardLineCorrectionIsSane(puck, [-88.95, 39.8425])).toBe(true);
    /* What a near-horizon unproject produces: kilometres away, or off the world. */
    expect(yardLineCorrectionIsSane(puck, [-88.95, 41.5])).toBe(false);
    expect(yardLineCorrectionIsSane(puck, [-88.95, 89.9])).toBe(false);
    expect(yardLineCorrectionIsSane(puck, [Number.NaN, 39.84])).toBe(false);
    expect(YARD_LINE_CORRECTION_MAX_M).toBeGreaterThan(500);
  });

  it("does not move the camera when the center already sits on the anchor", () => {
    const anchorX = padding.left + (800 - padding.left) / 2;
    expect(
      yardLineCenterAfterHardFollow({
        unproject,
        mapWidth: 800,
        mapHeight: 600,
        padding,
        offset: [0, 0],
        centerScreen: { x: anchorX, y: 300 },
      })
    ).toBeNull();
  });
});
