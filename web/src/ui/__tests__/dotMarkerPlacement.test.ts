import { describe, expect, it } from "vitest";
import { resolveDotMarkerPlacement } from "../dotMarkerPlacement";
import type { LngLat } from "../../nav/types";

const mk = (id: string, lngLat: LngLat) => ({ id, lngLat, label: id });

/* Real corridor: gentle curve ~1km long. */
const CORRIDOR: LngLat[] = Array.from({ length: 20 }, (_, i) => [
  -87.6 + i * 0.001,
  41.6 + Math.sin(i / 3) * 0.002,
]);

/* Synthetic straight stub ~500m north of the corridor. */
const STUB: LngLat[] = [
  [-87.6, 41.605],
  [-87.59, 41.605],
];

describe("resolveDotMarkerPlacement", () => {
  const events = [mk("e1", [-87.595, 41.601]), mk("e2", [-87.6, 41.6])];

  it("snaps onto the best-fit real corridor", () => {
    const p = resolveDotMarkerPlacement(
      new Map([
        ["r-a", CORRIDOR],
        ["r-b", STUB.map(([x, y]) => [x + 0.01, y] as LngLat)],
      ]),
      events
    );
    expect(p.paintedId).toBe("r-a");
    expect(p.markers.length).toBe(2);
    /* every marker lands ON a painted coordinate segment */
    for (const m of p.markers) {
      expect(m.lngLat[0]).toBeGreaterThanOrEqual(-87.62);
      expect(m.lngLat[0]).toBeLessThanOrEqual(-87.58);
    }
  });

  it("real corridor beats a synthetic stub within the penalty", () => {
    const near = STUB.map(([x, y]) => [x - 0.002, y - 0.001]) as LngLat[];
    const ev = [mk("e1", [-87.592, 41.604]), mk("e2", [-87.598, 41.6045])];
    const p = resolveDotMarkerPlacement(
      new Map([
        ["r-your-route", STUB],
        ["r-a", near],
      ]),
      ev
    );
    expect(p.paintedId).toBe("r-a");
  });

  it("synthetic stub still hosts markers when no real corridor is painted", () => {
    const ev = [mk("e1", [-87.595, 41.605])];
    const p = resolveDotMarkerPlacement(
      new Map([["r-rejoin", STUB]]),
      ev
    );
    expect(p.paintedId).toBe("r-rejoin");
    expect(p.markers.length).toBe(1);
  });

  it("returns nothing when no painted leg fits within 400m", () => {
    const far: LngLat[] = [
      [-90, 35],
      [-89.9, 35],
    ];
    const p = resolveDotMarkerPlacement(new Map([["r-a", far]]), events);
    expect(p.markers).toEqual([]);
    expect(p.paintedId).toBeNull();
  });

  it("drops individual events beyond 400m but keeps in-window ones", () => {
    const ev = [mk("near", [-87.6, 41.6]), mk("far", [-90, 35])];
    const p = resolveDotMarkerPlacement(new Map([["r-a", CORRIDOR]]), ev);
    expect(p.markers.map((m) => m.id)).toEqual(["near"]);
  });

  it("prefers the focused painted leg over a closer synthetic stub", () => {
    /* Events sit nearer the stub, but focus is the real corridor — the
     * Guatemala leftover-stub case must not steal the triangles. */
    const nearStub = [mk("e1", [-87.595, 41.605]), mk("e2", [-87.592, 41.605])];
    const p = resolveDotMarkerPlacement(
      new Map([
        ["r-rejoin", STUB],
        ["r-a", CORRIDOR],
      ]),
      nearStub,
      "r-a"
    );
    expect(p.paintedId).toBe("r-a");
  });

  it("falls back to fit when the focused leg is too far", () => {
    const farFocus: LngLat[] = [
      [-90, 35],
      [-89.9, 35],
    ];
    const p = resolveDotMarkerPlacement(
      new Map([
        ["r-a", farFocus],
        ["r-b", CORRIDOR],
      ]),
      events,
      "r-a"
    );
    expect(p.paintedId).toBe("r-b");
  });
});
