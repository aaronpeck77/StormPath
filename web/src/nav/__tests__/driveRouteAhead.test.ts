import { describe, expect, it } from "vitest";
import {
  formatDriveAheadBrief,
  isDriveAheadInsideSegment,
  type DriveAheadLine,
} from "../driveRouteAhead";

describe("isDriveAheadInsideSegment", () => {
  it("detects in-segment copy from buildDriveRouteAheadFromImpacts", () => {
    const line: DriveAheadLine = {
      text: "Wind Advisory — in this segment",
      kind: "weather",
      radarTier: "yellow",
    };
    expect(isDriveAheadInsideSegment(line)).toBe(true);
  });

  it("ignores ahead-of-puck headlines", () => {
    const line: DriveAheadLine = {
      text: "Heavy rain on route · 2.1 mi (~8 min)",
      kind: "weather",
      radarTier: "orange",
    };
    expect(isDriveAheadInsideSegment(line)).toBe(false);
  });
});

describe("formatDriveAheadBrief", () => {
  it("does not collapse in-segment lines to generic NWS copy", () => {
    const line: DriveAheadLine = {
      text: "Flood Advisory — in this segment",
      kind: "weather",
      radarTier: "orange",
    };
    expect(formatDriveAheadBrief(line)).toBe("Flood Advisory");
  });
});
