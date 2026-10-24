import { describe, expect, it } from "vitest";
import { advisoryVoiceBlocked, pickAdvisoryVoiceLine, shouldSpeakAdvisoryLine } from "../advisoryVoice";

describe("pickAdvisoryVoiceLine", () => {
  it("prefers hazard over ahead and nowcast", () => {
    expect(
      pickAdvisoryVoiceLine({
        nextHazardAtEtaLine: "Hail in 12 min",
        driveRouteAheadLine: { text: "Light rain ahead", kind: "weather", radarTier: "yellow" },
        nowcastLine: "72°F",
      })
    ).toBe("Hail in 12 min");
  });
});

describe("advisoryVoiceBlocked", () => {
  it("holds the hazard line through the opening maneuver and a close turn", () => {
    expect(
      advisoryVoiceBlocked({
        navigationStartedAtMs: 0,
        nowMs: 3_000,
        metersToManeuver: 800,
        turnQuietM: 250,
      })
    ).toBe(true);
    expect(
      advisoryVoiceBlocked({
        navigationStartedAtMs: 0,
        nowMs: 20_000,
        metersToManeuver: 40,
        turnQuietM: 250,
      })
    ).toBe(true);
    expect(
      advisoryVoiceBlocked({
        navigationStartedAtMs: 0,
        nowMs: 20_000,
        metersToManeuver: 900,
        turnQuietM: 250,
      })
    ).toBe(false);
  });
});

describe("shouldSpeakAdvisoryLine", () => {
  it("speaks a new line and ignores the same line until it changes", () => {
    expect(
      shouldSpeakAdvisoryLine({
        line: "Hail in 12 min",
        lastSpokenLine: null,
        lastSpokenAtMs: null,
        nowMs: 1_000,
        cooldownMs: 60_000,
      })
    ).toBe(true);

    expect(
      shouldSpeakAdvisoryLine({
        line: "Hail in 12 min",
        lastSpokenLine: "Hail in 12 min",
        lastSpokenAtMs: 1_000,
        nowMs: 90_000,
        cooldownMs: 60_000,
      })
    ).toBe(false);
  });
});
