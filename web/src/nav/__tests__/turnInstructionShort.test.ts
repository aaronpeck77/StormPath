import { describe, expect, it } from "vitest";
import { parseExitNumberFromStep, shortenTurnInstruction } from "../turnInstructionShort";

describe("parseExitNumberFromStep", () => {
  it("prefers Mapbox exits field", () => {
    expect(parseExitNumberFromStep("Take the ramp", "22A; 22B")).toBe("22A");
  });

  it("falls back to maneuver exit and instruction text", () => {
    expect(parseExitNumberFromStep("Take exit 14 toward downtown", undefined, 3)).toBe("3");
    expect(parseExitNumberFromStep("Take exit 14 toward downtown")).toBe("14");
  });
});

describe("shortenTurnInstruction exit numbers", () => {
  it("includes exit number on freeway ramps when Mapbox supplies it", () => {
    expect(
      shortenTurnInstruction(
        "Take exit 22 toward I-72 East",
        "I 72",
        "I 72",
        { exits: "22", maneuverType: "off ramp" }
      )
    ).toBe("Exit 22 · I-72");
  });

  it("uses destination when road ref is missing", () => {
    expect(
      shortenTurnInstruction("Take exit 5", undefined, undefined, {
        exits: "5",
        destinations: "Springfield; Decatur",
        maneuverType: "off ramp",
      })
    ).toBe("Exit 5 · toward Springfield");
  });

  it("leaves local turns unchanged when no exit data", () => {
    expect(shortenTurnInstruction("Turn right onto Camp Warren Road")).toBe(
      "Turn right onto Camp Warren Road"
    );
  });
});
