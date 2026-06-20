import { afterEach, describe, expect, it, vi } from "vitest";
import { acceptMapMatchSnap, matchGpsTraceToRoad } from "../mapboxMapMatching";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("acceptMapMatchSnap", () => {
  const raw: [number, number] = [-86.7812, 36.1608];
  const near: [number, number] = [-86.781, 36.161];

  it("accepts high-confidence snaps near the raw fix", () => {
    expect(acceptMapMatchSnap(raw, near, 0.88)).toBe(true);
  });

  it("rejects low confidence", () => {
    expect(acceptMapMatchSnap(raw, near, 0.1)).toBe(false);
  });

  it("rejects snaps far from raw GPS", () => {
    const far: [number, number] = [-86.7, 36.2];
    expect(acceptMapMatchSnap(raw, far, 0.95)).toBe(false);
  });
});

describe("matchGpsTraceToRoad", () => {
  it("returns snapped coordinate from Mapbox matching response", async () => {
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          matchings: [{ confidence: 0.92 }],
          tracepoints: [null, { location: [-86.781, 36.162] }],
        }),
      }))
    );

    const result = await matchGpsTraceToRoad("pk.test", [
      [-86.7812, 36.1618],
      [-86.781, 36.162],
    ]);
    expect(result.lngLat).toEqual([-86.781, 36.162]);
    expect(result.confidence).toBe(0.92);
  });

  it("returns null when fewer than two points are supplied", async () => {
    const result = await matchGpsTraceToRoad("pk.test", [[-86.78, 36.16]]);
    expect(result.lngLat).toBeNull();
  });
});
