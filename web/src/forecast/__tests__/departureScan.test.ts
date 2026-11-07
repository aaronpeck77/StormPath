import { describe, expect, it } from "vitest";
import { analyzeDepartureTiming } from "../departureScan";
import type {
  DepartureScanHour,
  DepartureScanLocation,
  DepartureScanWaypoint,
} from "../../services/departureScanTypes";

const NOW = new Date("2026-01-15T12:00:00").getTime(); // noon local

function hour(offsetMin: number, weatherCode = 1000, mmh = 0, prob = 0): DepartureScanHour {
  return {
    offsetMin,
    weatherCode,
    precipIntensityMmh: mmh,
    precipProbability: prob,
    windGustMph: 10,
  };
}

/** Single route-averaged location with hourly samples 0..12h. */
function loc(hours: DepartureScanHour[]): DepartureScanLocation[] {
  return [{ key: "route", lat: 40, lng: -100, hours }];
}

function clearDay(): DepartureScanHour[] {
  const out: DepartureScanHour[] = [];
  for (let m = 0; m <= 720; m += 60) out.push(hour(m, 1000));
  return out;
}

/** Storm occupies absolute hours 0–3 (offsetMin 0,60,120,180 bad). */
function stormNowThenClear(): DepartureScanHour[] {
  const out: DepartureScanHour[] = [];
  for (let m = 0; m <= 720; m += 60) {
    out.push(m <= 180 ? hour(m, 8000, 6, 0.9) : hour(m, 1000));
  }
  return out;
}

/** Storm sits at absolute hours 8–10 — a leaving-now trip never reaches it. */
function stormLater(): DepartureScanHour[] {
  const out: DepartureScanHour[] = [];
  for (let m = 0; m <= 720; m += 60) {
    out.push(m >= 480 && m <= 600 ? hour(m, 8000, 6, 0.9) : hour(m, 1000));
  }
  return out;
}

function stormEverywhere(): DepartureScanHour[] {
  const out: DepartureScanHour[] = [];
  for (let m = 0; m <= 720; m += 60) out.push(hour(m, 8000, 8, 0.95));
  return out;
}

/** 4-hour trip: waypoints at 0/60/120/180/240 min. */
const WAYPOINTS: DepartureScanWaypoint[] = [0, 60, 120, 180, 240].map((t) => ({
  lat: 40 + t / 10000,
  lng: -100,
  travelMin: t,
}));

describe("analyzeDepartureTiming", () => {
  it("recommends anytime on a clear corridor", () => {
    const a = analyzeDepartureTiming({
      locations: loc(clearDay()),
      waypoints: WAYPOINTS,
      tripEtaMin: 240,
      nowMs: NOW,
    });
    expect(a.status).toBe("ready");
    expect(a.recommendation?.kind).toBe("anytime");
    expect(a.stormWindow).toBeNull();
  });

  it("waits out a storm that is on top of us right now", () => {
    const a = analyzeDepartureTiming({
      locations: loc(stormNowThenClear()),
      waypoints: WAYPOINTS,
      tripEtaMin: 240,
      nowMs: NOW,
    });
    expect(a.status).toBe("ready");
    expect(a.recommendation?.kind).toBe("wait");
    // Earliest fully-clear window is ~3h out (storm ends at offset 180 + tolerance).
    expect(a.recommendation!.shiftMin).toBeGreaterThanOrEqual(120);
    expect(a.recommendation!.shiftMin).toBeLessThanOrEqual(240);
    expect(a.stormWindow).not.toBeNull();
    expect(a.recommendation!.arriveOffsetMin).toBe(
      a.recommendation!.shiftMin + 240
    );
  });

  it("says leave now when the storm is beyond the trip window", () => {
    const a = analyzeDepartureTiming({
      locations: loc(stormLater()),
      waypoints: WAYPOINTS,
      tripEtaMin: 240,
      nowMs: NOW,
    });
    expect(a.recommendation?.kind).toBe("leave_now");
    expect(a.recommendation!.shiftMin).toBe(0);
    expect(a.stormWindow).not.toBeNull();
    expect(a.recommendation!.detail).toContain("~");
  });

  it("is honest when every window is stormy", () => {
    const a = analyzeDepartureTiming({
      locations: loc(stormEverywhere()),
      waypoints: WAYPOINTS,
      tripEtaMin: 240,
      nowMs: NOW,
    });
    expect(a.recommendation?.kind).toBe("rough_anyway");
  });

  it("marks short-coverage scans partial", () => {
    const short = clearDay().filter((h) => h.offsetMin <= 180);
    const a = analyzeDepartureTiming({
      locations: loc(short),
      waypoints: WAYPOINTS,
      tripEtaMin: 240,
      nowMs: NOW,
    });
    expect(a.status).toBe("partial");
    expect(a.candidates.length).toBeGreaterThan(0);
  });

  it("returns unavailable with no forecast data", () => {
    const a = analyzeDepartureTiming({
      locations: [],
      waypoints: WAYPOINTS,
      tripEtaMin: 240,
      nowMs: NOW,
    });
    expect(a.status).toBe("unavailable");
    expect(a.recommendation).toBeNull();
  });

  it("returns unavailable when waypoints are missing", () => {
    const a = analyzeDepartureTiming({
      locations: loc(clearDay()),
      waypoints: [],
      tripEtaMin: 240,
      nowMs: NOW,
    });
    expect(a.status).toBe("unavailable");
  });
});
