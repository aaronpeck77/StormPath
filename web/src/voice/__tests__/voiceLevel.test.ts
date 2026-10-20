import { describe, expect, it } from "vitest";
import { assistantBrief, isTripAction, isTripTalk } from "../../grok/assistantTurn";
import { voiceHoldMs } from "../../grok/assistantFloor";
import type { StormyPacket } from "../../stormy/stormyFence";
import {
  assistantButtonLabel,
  assistantEnabledFromLegacy,
  speechVoiceFlags,
  stormyButtonFor,
  voiceLevelFromLegacy,
  voiceSpeaks,
} from "../voiceLevel";

const packet = {
  aheadLine: "Rain in 20 miles",
  hazards: [],
  routes: [],
  driving: false,
  turnImminent: false,
  question: "",
  weather: ["Thunderstorm warning"],
  traffic: [],
  roads: [],
  forecast: "",
  destination: "Orlando",
  eta: "15 hours",
  milesLeft: "1000 miles",
  stops: [],
  here: "Decatur, Illinois",
} as StormyPacket;

describe("voice levels", () => {
  it("starts on no voice and keeps the assistant as its own switch", () => {
    expect(voiceLevelFromLegacy("assistant")).toBe("off");
    expect(voiceLevelFromLegacy(null)).toBe("off");
    expect(voiceLevelFromLegacy("basic")).toBe("basic");
    expect(assistantEnabledFromLegacy("assistant", null)).toBe(true);
    expect(assistantEnabledFromLegacy("basic", null)).toBe(false);
    expect(assistantEnabledFromLegacy("off", "1")).toBe(true);
    expect(voiceSpeaks("off")).toBe(false);
    expect(voiceSpeaks("basic")).toBe(true);
    expect(stormyButtonFor("basic", false)).toBe(true);
    expect(stormyButtonFor("basic", true)).toBe(false);
    expect(stormyButtonFor("enhanced", true)).toBe(false);
    expect(speechVoiceFlags("enhanced", true)).toEqual({ forAssistant: true });
    expect(speechVoiceFlags("enhanced", false)).toEqual({});
    expect(speechVoiceFlags("basic", true)).toEqual({});
    expect(speechVoiceFlags("off", true)).toEqual({});
    expect(assistantButtonLabel("  Steve  ")).toBe("Steve");
    expect(assistantButtonLabel("")).toBe("Grok");
  });

  it("runs a destination on the phone and sends an open question with measured facts", () => {
    expect(isTripAction("go_to")).toBe(true);
    expect(isTripAction("start_drive")).toBe(true);
    expect(isTripAction("end_trip")).toBe(true);
    expect(isTripAction("explain_ahead")).toBe(false);
    const brief = assistantBrief("How's the weather?", packet);
    expect(brief).toContain("How's the weather?");
    expect(brief).toContain("Thunderstorm warning");
    expect(brief).toContain("Orlando");
    expect(brief).toContain("what StormPath knows about the trip");
    const free = assistantBrief("Tell me a joke about dogs", packet);
    const company = assistantBrief("I'm getting sleepy. Talk with me and help me stay awake.", packet);
    expect(isTripTalk("Tell me a joke about dogs")).toBe(false);
    expect(isTripTalk("I'm getting sleepy. Talk with me and help me stay awake.")).toBe(false);
    expect(isTripTalk("How's the weather?")).toBe(true);
    expect(company).toContain("free talk");
    expect(company).not.toContain("Orlando");
    expect(company).not.toContain("Thunderstorm");
    expect(free).toContain("free talk");
    expect(free).not.toContain("Orlando");
    expect(free).not.toContain("Thunderstorm");
    expect(voiceHoldMs("free", 10)).toBeGreaterThan(voiceHoldMs("trip", 10));
  });
});
