import { describe, expect, it } from "vitest";
import {
  buildPassengerAdvisoryLine,
  formatPassengerClock,
  type PassengerAdvisoryLine,
} from "../passengerAdvisory";
import type { RouteImpact } from "../routeImpacts";

const NOW = Date.parse("2026-10-09T23:00:00.000Z");

function impact(overrides: Partial<RouteImpact> = {}): RouteImpact {
  return {
    id: "sev",
    category: "weather",
    severity: "avoid",
    confidence: "high",
    source: "nws",
    lngLat: [-88.16, 39.25],
    alongMeters: 40_000,
    startMeters: 40_000,
    endMeters: 48_000,
    distanceAheadMeters: 40_000,
    etaAheadMinutes: 30,
    driverHeadline: "Severe Thunderstorm Warning",
    driverAction: "prepare",
    roadEffect: "Dangerous storm.",
    detail: "Detail.",
    numericSeverity: 90,
    arrivalVerdict: "affects_you",
    hazardExpiresIso: new Date(NOW + 50 * 60_000).toISOString(),
    ...overrides,
  };
}

const greenup = {
  hasRoute: true,
  navigationStarted: false,
  metersToManeuver: null,
  nowMs: NOW,
  impacts: [impact()],
  placeAnchors: [{ lngLat: [-88.16, 39.25] as [number, number], place: "Greenup", exitNumber: null }],
  turnSteps: [],
  userAlongM: 0,
  totalM: 80_000,
  planEtaMinutes: 70,
  driveEtaMinutes: null,
  minutePrecip: null,
};

function text(line: PassengerAdvisoryLine | null): string {
  return line?.text ?? "";
}

describe("buildPassengerAdvisoryLine", () => {
  it("offers a real delay before Go when the warning ends soon enough", () => {
    const line = buildPassengerAdvisoryLine(greenup);
    expect(line?.badge).toBe("Leave");
    expect(text(line)).toBe(
      `If you leave now, you may meet severe weather by Greenup. Waiting about 20 minutes, until around ${formatPassengerClock(NOW + 20 * 60_000)}, may let you miss it.`
    );
  });

  it("does not invent a delay when the warning outlasts a short wait", () => {
    const line = buildPassengerAdvisoryLine({
      ...greenup,
      impacts: [impact({ hazardExpiresIso: new Date(NOW + 4 * 60 * 60_000).toISOString() })],
    });
    expect(text(line)).toBe("If you leave now, you may meet severe weather by Greenup.");
    expect(text(line)).not.toMatch(/Waiting about/);
  });

  it("stays quiet for a shower, a far storm, a watch, and a storm that will be gone", () => {
    expect(
      buildPassengerAdvisoryLine({
        ...greenup,
        impacts: [impact({ severity: "caution", driverHeadline: "Light rain" })],
      })
    ).toBeNull();
    expect(
      buildPassengerAdvisoryLine({
        ...greenup,
        impacts: [impact({ etaAheadMinutes: 80 })],
      })
    ).toBeNull();
    expect(
      buildPassengerAdvisoryLine({
        ...greenup,
        impacts: [impact({ driverHeadline: "Severe Thunderstorm Watch", severity: "serious" })],
      })
    ).toBeNull();
    expect(
      buildPassengerAdvisoryLine({
        ...greenup,
        impacts: [impact({ arrivalVerdict: "may_pass" })],
      })
    ).toBeNull();
    expect(
      buildPassengerAdvisoryLine({
        ...greenup,
        impacts: [impact({ arrivalVerdict: "uncertain" })],
      })
    ).toBeNull();
  });

  it("does not use driveway rain to time a storm 30 minutes down the road", () => {
    const minutes = Array.from({ length: 60 }, (_, i) => ({
      timeIso: new Date(NOW + i * 60_000).toISOString(),
      precipIntensityMmh: i < 20 ? 8 : 0,
      precipProbability: i < 20 ? 0.8 : 0,
      precipType: 1,
    }));
    const line = buildPassengerAdvisoryLine({
      ...greenup,
      impacts: [impact({ hazardExpiresIso: null, etaAheadMinutes: 30 })],
      minutePrecip: { fetchedAt: NOW, lat: 39.2, lng: -88.1, minutes },
    });
    expect(text(line)).toBe("If you leave now, you may meet severe weather by Greenup.");
  });

  it("uses minute rain only when the severe weather is at the start", () => {
    const minutes = Array.from({ length: 60 }, (_, i) => ({
      timeIso: new Date(NOW + i * 60_000).toISOString(),
      precipIntensityMmh: i < 18 ? 8 : 0,
      precipProbability: i < 18 ? 0.8 : 0,
      precipType: 1,
    }));
    const line = buildPassengerAdvisoryLine({
      ...greenup,
      impacts: [impact({ hazardExpiresIso: null, etaAheadMinutes: 10 })],
      minutePrecip: { fetchedAt: NOW, lat: 39.2, lng: -88.1, minutes },
    });
    expect(text(line)).toContain("Waiting about 18 minutes");
    expect(text(line)).toContain(formatPassengerClock(NOW + 18 * 60_000));
  });

  it("after Go, names a town before the storm and never says to delay departure", () => {
    const line = buildPassengerAdvisoryLine({
      ...greenup,
      navigationStarted: true,
      driveEtaMinutes: 50,
      turnSteps: [
        { instruction: "Head out", distanceM: 12_000 },
        { instruction: "toward Casey", distanceM: 20_000, towardPlace: "Casey" },
        { instruction: "toward Greenup", distanceM: 20_000, towardPlace: "Greenup" },
      ],
    });
    expect(line?.badge).toBe("Ahead");
    expect(text(line)).toMatch(/Casey is about \d+ minutes ahead/);
    expect(text(line)).not.toMatch(/leave now/i);
  });

  it("stays quiet through a close turn", () => {
    const line = buildPassengerAdvisoryLine({
      ...greenup,
      navigationStarted: true,
      metersToManeuver: 80,
      driveEtaMinutes: 50,
      turnSteps: [{ instruction: "toward Casey", distanceM: 12_000, towardPlace: "Casey" }],
    });
    expect(line).toBeNull();
  });
});
