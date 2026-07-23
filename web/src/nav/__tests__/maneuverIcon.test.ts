import { describe, expect, it } from "vitest";
import {
  inferManeuverIconFromInstruction,
  mapboxStyleManeuverIcon,
  resolvePrimaryManeuverIcon,
} from "../maneuverIcon";

describe("mapboxStyleManeuverIcon", () => {
  it("maps turn + left/right to turn arrows", () => {
    expect(mapboxStyleManeuverIcon("turn", "left")).toBe("↰");
    expect(mapboxStyleManeuverIcon("turn", "right")).toBe("↱");
    expect(mapboxStyleManeuverIcon("turn", "sharp left")).toBe("↲");
    expect(mapboxStyleManeuverIcon("turn", "slight right")).toBe("↗");
  });

  it("uses modifier even when type is missing or unfamiliar", () => {
    expect(mapboxStyleManeuverIcon(undefined, "left")).toBe("↰");
    expect(mapboxStyleManeuverIcon("weirdType", "right")).toBe("↱");
  });
});

describe("inferManeuverIconFromInstruction", () => {
  it("detects left/right without requiring the word turn", () => {
    expect(inferManeuverIconFromInstruction("Left onto Main Street")).toBe("↰");
    expect(inferManeuverIconFromInstruction("Take a right")).toBe("↱");
    expect(inferManeuverIconFromInstruction("Keep left")).toBe("↰");
  });

  it("defaults street-name-only text to straight (caller should prefer structured data)", () => {
    expect(inferManeuverIconFromInstruction("Main Street")).toBe("↑");
  });
});

describe("resolvePrimaryManeuverIcon", () => {
  it("prefers structured turn metadata over street-name override text", () => {
    expect(
      resolvePrimaryManeuverIcon({
        stayOnMode: false,
        step: {
          instruction: "Turn left onto Main Street",
          maneuverType: "turn",
          maneuverModifier: "left",
        },
        // Native visual primary is often just the road name — must NOT force a straight arrow.
        instructionOverride: "Main Street",
      })
    ).toBe("↰");
  });

  it("still shows a turn arrow when only the override text has the direction", () => {
    expect(
      resolvePrimaryManeuverIcon({
        stayOnMode: false,
        step: { instruction: "Continue" },
        instructionOverride: "Turn right onto Oak Ave",
      })
    ).toBe("↱");
  });

  it("keeps a straight arrow in stay-on mode", () => {
    expect(
      resolvePrimaryManeuverIcon({
        stayOnMode: true,
        step: {
          instruction: "Turn left onto Main Street",
          maneuverType: "turn",
          maneuverModifier: "left",
        },
        instructionOverride: "Main Street",
      })
    ).toBe("↑");
  });
});
