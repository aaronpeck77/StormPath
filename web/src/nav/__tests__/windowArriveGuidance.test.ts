import { describe, expect, it } from "vitest";
import {
  continueAlongInstruction,
  driverBannerStepIndex,
  isArriveGuidanceInstruction,
  isArriveGuidanceStep,
  nextNonArriveStepIndex,
} from "../windowArriveGuidance";
import type { RouteTurnStep } from "../types";

describe("windowArriveGuidance", () => {
  it("detects arrive copy and maneuver type", () => {
    expect(isArriveGuidanceInstruction("You have arrived at your destination")).toBe(true);
    expect(isArriveGuidanceInstruction("Arriving")).toBe(true);
    expect(isArriveGuidanceStep({ maneuverType: "arrive", instruction: "Main St" })).toBe(true);
    expect(isArriveGuidanceStep({ instruction: "Turn right onto Oak" })).toBe(false);
  });

  it("skips the window-end arrive when picking the banner step", () => {
    const steps: RouteTurnStep[] = [
      { instruction: "Head north on I-75", maneuverType: "depart" },
      { instruction: "Continue on I-75", maneuverType: "continue" },
      { instruction: "You have arrived at your destination", maneuverType: "arrive" },
    ];
    expect(nextNonArriveStepIndex(steps, 0)).toBe(1);
    expect(nextNonArriveStepIndex(steps, 1)).toBeNull();
    expect(driverBannerStepIndex(steps, 1, 0)).toBe(1);
  });

  it("uses the current road for continue", () => {
    expect(continueAlongInstruction("I-75 N")).toBe("Continue on I-75 N");
    expect(continueAlongInstruction("")).toBe("Continue");
  });
});
