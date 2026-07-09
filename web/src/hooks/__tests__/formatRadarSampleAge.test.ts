import { describe, expect, it } from "vitest";
import { formatRadarSampleAge } from "../useRadarBandsAlongRoute";

describe("formatRadarSampleAge", () => {
  it("returns null without a timestamp", () => {
    expect(formatRadarSampleAge(null)).toBeNull();
  });

  it("formats recent and older ages", () => {
    const now = 1_000_000_000;
    expect(formatRadarSampleAge(now - 20_000, now)).toBe("Radar · just now");
    expect(formatRadarSampleAge(now - 60_000, now)).toBe("Radar · 1 min ago");
    expect(formatRadarSampleAge(now - 12 * 60_000, now)).toBe("Radar · 12 min ago");
    expect(formatRadarSampleAge(now - 2 * 60 * 60_000, now)).toBe("Radar · 2 hr ago");
  });
});
