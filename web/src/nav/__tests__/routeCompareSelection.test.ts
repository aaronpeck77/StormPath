import { describe, expect, it } from "vitest";
import {
  defaultRouteCompareSelection,
  viewModeAfterCompareCancel,
} from "../routeCompareSelection";

describe("defaultRouteCompareSelection", () => {
  it("keeps r-a / r-b / r-c", () => {
    expect(defaultRouteCompareSelection("r-b")).toBe("r-b");
    expect(defaultRouteCompareSelection("r-c")).toBe("r-c");
  });

  it("falls back to r-a for other ids", () => {
    expect(defaultRouteCompareSelection("r-rejoin")).toBe("r-a");
    expect(defaultRouteCompareSelection("personal-fork")).toBe("r-a");
  });
});

describe("viewModeAfterCompareCancel", () => {
  it("avoids restoring drive while still navigating", () => {
    expect(viewModeAfterCompareCancel("drive", true)).toBe("topdown");
  });

  it("restores non-drive modes", () => {
    expect(viewModeAfterCompareCancel("route", true)).toBe("route");
    expect(viewModeAfterCompareCancel("topdown", false)).toBe("topdown");
  });

  it("defaults when no restore snapshot", () => {
    expect(viewModeAfterCompareCancel(null, true)).toBe("topdown");
    expect(viewModeAfterCompareCancel(undefined, false)).toBe("route");
  });
});
