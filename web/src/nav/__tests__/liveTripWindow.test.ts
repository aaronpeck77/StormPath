import { describe, expect, it } from "vitest";
import { LONG_TRIP_ROUTE_M } from "../../utils/dataSaver";
import { polylineLengthMeters } from "../routeGeometry";
import type { LngLat } from "../types";
import {
  computeLiveTripWindow,
  isPlanDestinationArrival,
  LIVE_TRIP_WINDOW_AHEAD_M,
  shouldHandoffLiveTripWindow,
  sliceCorridorToLiveWindow,
} from "../liveTripWindow";

function routeWithLengthM(targetM: number, vertexCount: number): LngLat[] {
  const out: LngLat[] = [[-96, 41]];
  const segM = targetM / Math.max(1, vertexCount - 1);
  const latStep = segM / 111_320;
  for (let i = 1; i < vertexCount; i++) {
    const prev = out[out.length - 1]!;
    out.push([prev[0], prev[1] + latStep]);
  }
  return out;
}

describe("liveTripWindow", () => {
  it("leaves short trips as one final window to dest", () => {
    const geometry = routeWithLengthM(40_000, 40);
    const w = computeLiveTripWindow(geometry, geometry[0]!);
    expect(w).not.toBeNull();
    expect(w!.isFinal).toBe(true);
    expect(w!.endAlongM).toBeCloseTo(polylineLengthMeters(geometry), -1);
  });

  it("caps Core to ~100 mi on a long remaining plan", () => {
    const geometry = routeWithLengthM(LONG_TRIP_ROUTE_M * 4, 400);
    const w = computeLiveTripWindow(geometry, geometry[0]!);
    expect(w).not.toBeNull();
    expect(w!.isFinal).toBe(false);
    expect(w!.endAlongM - w!.startAlongM).toBeLessThanOrEqual(LIVE_TRIP_WINDOW_AHEAD_M + 2_000);
    const slice = sliceCorridorToLiveWindow(geometry, geometry[0]!);
    expect(polylineLengthMeters(slice)).toBeLessThan(polylineLengthMeters(geometry) * 0.4);
  });

  it("takes the rest when the leftover would be a stub", () => {
    const geometry = routeWithLengthM(LONG_TRIP_ROUTE_M + 50_000, 120);
    const alongUser = geometry[Math.floor(geometry.length * 0.55)]!;
    const w = computeLiveTripWindow(geometry, alongUser);
    expect(w).not.toBeNull();
    expect(w!.isFinal).toBe(true);
  });

  it("hands off with ~40 mi left in a non-final window", () => {
    const geometry = routeWithLengthM(LONG_TRIP_ROUTE_M * 3, 300);
    const w = computeLiveTripWindow(geometry, geometry[0]!);
    expect(w).not.toBeNull();
    expect(shouldHandoffLiveTripWindow(w!, w!.endAlongM - 30_000)).toBe(true);
    expect(shouldHandoffLiveTripWindow(w!, w!.startAlongM + 1_000)).toBe(false);
    expect(shouldHandoffLiveTripWindow({ ...w!, isFinal: true }, w!.endAlongM - 1_000)).toBe(
      false
    );
  });

  it("does not treat a window-end arrive as the destination pin", () => {
    const geometry = routeWithLengthM(LONG_TRIP_ROUTE_M * 3, 300);
    const w = computeLiveTripWindow(geometry, geometry[0]!);
    const dest = geometry[geometry.length - 1]!;
    const windowEnd = sliceCorridorToLiveWindow(geometry, geometry[0]!).at(-1)!;
    expect(isPlanDestinationArrival(dest, windowEnd, w)).toBe(false);
    expect(
      isPlanDestinationArrival(dest, dest, { ...w!, isFinal: true, endAlongM: w!.totalPlanM })
    ).toBe(true);
  });
});
