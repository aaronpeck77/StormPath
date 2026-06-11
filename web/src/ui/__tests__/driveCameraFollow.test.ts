import { describe, expect, it } from "vitest";

/** Mirror of drive follow-cam center drift check in DriveMap (lng/lat delta). */
function driveCameraNeedsCenterSync(
  camCenter: [number, number] | null,
  puckPos: [number, number] | null,
  noopDelta = 0.000005
): boolean {
  if (!camCenter || !puckPos) return false;
  return (
    Math.abs(camCenter[0] - puckPos[0]) > noopDelta ||
    Math.abs(camCenter[1] - puckPos[1]) > noopDelta
  );
}

describe("driveCameraNeedsCenterSync", () => {
  it("detects desync even when the puck did not move this frame", () => {
    const puck: [number, number] = [-86.78, 36.16];
    const cam: [number, number] = [-86.79, 36.16];
    expect(driveCameraNeedsCenterSync(cam, puck)).toBe(true);
  });

  it("ignores sub-meter jitter", () => {
    const puck: [number, number] = [-86.78, 36.16];
    const cam: [number, number] = [-86.7800001, 36.1600001];
    expect(driveCameraNeedsCenterSync(cam, puck)).toBe(false);
  });
});
