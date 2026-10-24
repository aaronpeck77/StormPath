import { describe, expect, it } from "vitest";
import { METERS_PER_MILE } from "../constants";
import { mapboxExcludePointsParam, planJamHop, type JamHopPlan } from "../jamHopPlan";
import { destinationPointMeters, haversineMeters } from "../routeGeometry";
import type { LngLat } from "../types";

const MI = METERS_PER_MILE;
const HIGHWAY = 29;

function lineNorth(miles: number): LngLat[] {
  const start: LngLat = [-95.5, 29.78];
  const points: LngLat[] = [start];
  for (let along = 200; along <= miles * MI; along += 200) {
    points.push(destinationPointMeters(start[0], start[1], 0, along));
  }
  return points;
}

function alongFromStart(start: LngLat, point: LngLat): number {
  return haversineMeters(start, point);
}

/** What the retired pin rule would have picked: two miles before the wreck, three miles after. */
function retiredPinExitMiles(causeMi: number): number {
  return causeMi - 2;
}

describe("jam hop simulations", () => {
  const line = lineNorth(30);
  const start = line[0]!;

  function hop(partial: {
    userMi: number;
    tailMi: number;
    clearMi: number;
    speed?: number;
    miles?: number;
    exitsMi?: number[];
  }): JamHopPlan {
    return planJamHop({
      line: partial.miles ? lineNorth(partial.miles) : line,
      userAlongMeters: partial.userMi * MI,
      tailMeters: partial.tailMi * MI,
      clearMeters: partial.clearMi * MI,
      speedMps: partial.speed ?? HIGHWAY,
      exitsMeters: partial.exitsMi?.map((mile) => mile * MI),
    });
  }

  it("leaves before the tail and comes back after the highway is moving", () => {
    const plan = hop({ userMi: 0, tailMi: 6, clearMi: 14 });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.fromQueue).toBe(false);
    expect(plan.canTakeNow).toBe(true);
    expect(plan.leaveByMeters / MI).toBeLessThan(6);
    expect(plan.rejoinMeters / MI).toBeGreaterThan(14);
    expect(plan.excludePoints.length).toBeGreaterThan(5);
    expect(plan.excludePoints.length).toBeLessThanOrEqual(50);
    for (const point of plan.excludePoints) {
      const alongMi = alongFromStart(start, point) / MI;
      expect(alongMi).toBeGreaterThan(6);
      expect(alongMi).toBeLessThan(14);
    }
    expect(mapboxExcludePointsParam(plan.excludePoints).startsWith("point(")).toBe(true);
  });

  it("shows the old pin rule putting the exit inside an eight-mile queue", () => {
    const tailMi = 6;
    const causeMi = 14;
    const oldExitMi = retiredPinExitMiles(causeMi);
    expect(oldExitMi).toBeGreaterThan(tailMi);

    const plan = hop({ userMi: 0, tailMi, clearMi: causeMi });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.leaveByMeters / MI).toBeLessThan(tailMi);
    expect(plan.rejoinMeters / MI).toBeGreaterThan(causeMi);
  });

  it("keeps the car in the queue until the next exit is close, then allows the hop", () => {
    const waiting = hop({ userMi: 7, tailMi: 6, clearMi: 14, exitsMi: [5, 9] });
    expect(waiting.ok).toBe(true);
    if (!waiting.ok) return;
    expect(waiting.fromQueue).toBe(true);
    expect(waiting.canTakeNow).toBe(false);
    expect(waiting.leaveByMeters / MI).toBeCloseTo(9, 1);
    for (const point of waiting.excludePoints) {
      const alongMi = alongFromStart(start, point) / MI;
      expect(alongMi).toBeGreaterThan(9);
      expect(alongMi).toBeLessThan(14);
    }

    const ready = hop({ userMi: 8.6, tailMi: 6, clearMi: 14, exitsMi: [5, 9] });
    expect(ready.ok).toBe(true);
    if (!ready.ok) return;
    expect(ready.canTakeNow).toBe(true);
    expect(ready.leaveByMeters / MI).toBeCloseTo(9, 1);
  });

  it("stays in the queue when the next exit is the last of the jam", () => {
    expect(hop({ userMi: 7, tailMi: 6, clearMi: 14, exitsMi: [13] })).toEqual({
      ok: false,
      reason: "stay-in-queue",
    });
  });

  it("stays in the queue when no exit is left ahead", () => {
    expect(hop({ userMi: 7, tailMi: 6, clearMi: 14 })).toEqual({ ok: false, reason: "no-exit" });
    expect(hop({ userMi: 10, tailMi: 6, clearMi: 14, exitsMi: [8] })).toEqual({
      ok: false,
      reason: "no-exit",
    });
  });

  it("refuses when the tail is too close to take an exit", () => {
    expect(hop({ userMi: 5.6, tailMi: 6, clearMi: 14 })).toEqual({ ok: false, reason: "no-time" });
  });

  it("refuses when the locked line ends inside the queue", () => {
    expect(hop({ userMi: 0, tailMi: 6, clearMi: 14, miles: 12 })).toEqual({
      ok: false,
      reason: "no-rejoin",
    });
  });

  it("still marks a short closure, and only that closure", () => {
    const plan = hop({ userMi: 0, tailMi: 8, clearMi: 8.4 });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.excludePoints.length).toBeGreaterThan(0);
    for (const point of plan.excludePoints) {
      const alongMi = alongFromStart(start, point) / MI;
      expect(alongMi).toBeGreaterThan(8);
      expect(alongMi).toBeLessThan(8.4);
    }
    expect(plan.rejoinMeters / MI).toBeGreaterThan(8.4);
  });
});
