import { describe, expect, it } from "vitest";
import { centerForPuckScreenAnchor } from "../driveFollowCamAnchor";

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
});
