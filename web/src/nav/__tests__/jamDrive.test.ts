import { describe, expect, it } from "vitest";
import { METERS_PER_MILE } from "../constants";
import { exitsAlongSteps, jamHopOffer, jamStretchAhead } from "../jamDrive";
import { destinationPointMeters } from "../routeGeometry";
import type { LngLat } from "../types";

const MI = METERS_PER_MILE;

function lineNorth(miles: number): LngLat[] {
  const start: LngLat = [-95.5, 29.78];
  const points: LngLat[] = [start];
  for (let along = 400; along <= miles * MI; along += 400) {
    points.push(destinationPointMeters(start[0], start[1], 0, along));
  }
  return points;
}

/** One congestion number per equal slice of the route. */
function samples(miles: number, severeFrom: number, severeTo: number): number[] {
  const slices = 20;
  const out: number[] = [];
  for (let i = 0; i < slices; i++) {
    const mid = ((i + 0.5) / slices) * miles;
    out.push(mid >= severeFrom && mid < severeTo ? 95 : 10);
  }
  return out;
}

describe("jam stretch and exits", () => {
  it("finds the tail and the clear point of a severe run", () => {
    const stretch = jamStretchAhead(samples(30, 6, 14), 30 * MI, 0);
    expect(stretch).not.toBeNull();
    expect(stretch!.tailMeters / MI).toBeGreaterThan(5);
    expect(stretch!.tailMeters / MI).toBeLessThan(7);
    expect(stretch!.clearMeters / MI).toBeGreaterThan(13);
    expect(stretch!.clearMeters / MI).toBeLessThan(15);
  });

  it("ignores a severe run the car has already passed", () => {
    expect(jamStretchAhead(samples(30, 2, 4), 30 * MI, 10 * MI)).toBeNull();
  });

  it("places an exit at the start of the off-ramp step", () => {
    expect(
      exitsAlongSteps([
        { distanceM: 5 * MI, maneuverType: "continue" },
        { distanceM: 0.4 * MI, maneuverType: "off ramp", exitNumber: "48" },
        { distanceM: 2 * MI, maneuverType: "continue" },
      ])
    ).toEqual([5 * MI]);
  });

  it("offers the hop from a severe stretch and the exits on the route", () => {
    const offer = jamHopOffer({
      line: lineNorth(30),
      userAlongMeters: 7 * MI,
      speedMps: 4,
      congestion: samples(30, 6, 14),
      steps: [
        { distanceM: 9 * MI, maneuverType: "continue" },
        { distanceM: MI, maneuverType: "off ramp", exitNumber: "18" },
      ],
    });
    expect(offer?.ok).toBe(true);
    expect(offer?.fromQueue).toBe(true);
    expect(offer?.canTakeNow).toBe(false);
    expect((offer?.leaveByMeters ?? 0) / MI).toBeCloseTo(9, 0);
  });
});
