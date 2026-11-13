import { describe, expect, it } from "vitest";
import { pickConsensusTrace } from "../corridorConsensus";
import type { LngLat } from "../../nav/types";

function line(a: LngLat, b: LngLat, n = 24): LngLat[] {
  const out: LngLat[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

/** Two-segment path a→via→b — a dogleg/loop off the direct corridor. */
function viaLine(a: LngLat, via: LngLat, b: LngLat, n = 24): LngLat[] {
  const out: LngLat[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    if (t < 0.5) {
      const u = t / 0.5;
      out.push([a[0] + (via[0] - a[0]) * u, a[1] + (via[1] - a[1]) * u]);
    } else {
      const u = (t - 0.5) / 0.5;
      out.push([via[0] + (b[0] - via[0]) * u, via[1] + (b[1] - via[1]) * u]);
    }
  }
  return out;
}

const A: LngLat = [-88.95, 39.85];
const B: LngLat = [-88.2, 39.75];
/** ~30 km north of the direct corridor — unmistakably "a road he never takes". */
const NORTH: LngLat = [-88.5, 40.15];

describe("pickConsensusTrace", () => {
  it("returns null when no trace has at least 2 points", () => {
    expect(pickConsensusTrace([[], [[-88, 39]]], line(A, B))).toBeNull();
  });

  it("returns the only usable trace", () => {
    const only = line(A, B);
    expect(pickConsensusTrace([[[-88, 39]], only], only)).toEqual(only);
  });

  it("picks the trace the majority agrees on, not the densest oddball", () => {
    const weird = viaLine(A, NORTH, B, 60); // most points, wrong middle
    const traces = [line(A, B), weird, line(A, B, 20), line(A, B, 30)];
    const consensus = pickConsensusTrace(traces, traces[0]!);
    expect(consensus).not.toBeNull();
    // Consensus stays on the direct corridor — the northern dogleg (40.15)
    // never becomes part of "Your route".
    const maxLat = Math.max(...consensus!.map((p) => p[1]));
    expect(maxLat).toBeLessThan(39.9);
  });

  it("orients mixed-direction traces before scoring", () => {
    const fwd = line(A, B);
    const rev = [...line(A, B)].reverse();
    const consensus = pickConsensusTrace([fwd, rev, line(A, B, 18)], fwd);
    expect(consensus).not.toBeNull();
    // Oriented like the reference: starts near A, ends near B.
    expect(consensus![0]![1]).toBeGreaterThan(consensus![consensus!.length - 1]![1]);
    expect(Math.abs(consensus![0]![0] - A[0])).toBeLessThan(0.01);
    expect(Math.abs(consensus![consensus!.length - 1]![0] - B[0])).toBeLessThan(0.01);
  });
});
