import { describe, expect, it } from "vitest";
import {
  formatVoiceDistancePrefix,
  voiceBandForDistance,
  voiceBandToSpeak,
  voiceManeuverThresholds,
} from "../voiceManeuverTiming";

describe("voiceManeuverTiming", () => {
  it("widens bands at highway speed", () => {
    const city = voiceManeuverThresholds(8);
    const highway = voiceManeuverThresholds(25);
    expect(highway.earlyM).toBeGreaterThan(city.earlyM);
    expect(highway.mediumM).toBeGreaterThan(city.mediumM);
  });

  it("maps distance to the tightest band inside thresholds", () => {
    const t = voiceManeuverThresholds(8);
    expect(voiceBandForDistance(80, t)).toBe("medium");
    expect(voiceBandForDistance(30, t)).toBe("close");
    expect(voiceBandForDistance(10, t)).toBe("now");
    expect(voiceBandForDistance(400, t)).toBeNull();
  });

  it("announces early on step change when still far away", () => {
    const t = voiceManeuverThresholds(25);
    expect(voiceBandToSpeak(2500, t, true)).toBe("early");
    expect(voiceBandToSpeak(2500, t, false)).toBeNull();
  });

  it("formats now and distance prefixes", () => {
    expect(formatVoiceDistancePrefix(40, "now")).toBe("Now. ");
    expect(formatVoiceDistancePrefix(400, "early")).toMatch(/feet|miles/i);
  });
});
