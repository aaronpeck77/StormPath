import { describe, expect, it } from "vitest";
import { lockedRouteKind, offRouteReplanCopy } from "../routeSummary";

describe("lockedRouteKind", () => {
  it("reads role first", () => {
    expect(lockedRouteKind({ role: "fastest", label: "No interstate" })).toBe("fastest");
    expect(lockedRouteKind({ role: "hazardSmart", label: "Main" })).toBe("no_interstate");
    expect(lockedRouteKind({ role: "balanced", label: "Main" })).toBe("backroads");
  });

  it("falls back to the label when role is missing", () => {
    expect(lockedRouteKind({ label: "No interstate" })).toBe("no_interstate");
    expect(lockedRouteKind({ label: "Main · fastest" })).toBe("fastest");
    expect(lockedRouteKind({ label: "Country drive" })).toBe("backroads");
  });
});

describe("offRouteReplanCopy", () => {
  it("names fastest vs no-interstate instead of a generic new route", () => {
    expect(
      offRouteReplanCopy({ kind: "fastest", silent: false, hasAlternate: false }).hint
    ).toBe("New fastest from here.");
    expect(
      offRouteReplanCopy({ kind: "no_interstate", silent: false, hasAlternate: false }).hint
    ).toBe("New route — staying off interstates.");
  });

  it("keeps the B-is-on-Map line only on a fastest replan that still has an alternate", () => {
    expect(
      offRouteReplanCopy({ kind: "fastest", silent: false, hasAlternate: true }).hint
    ).toBe("New fastest from here — B is on Map / Route.");
    expect(
      offRouteReplanCopy({ kind: "no_interstate", silent: false, hasAlternate: true }).hint
    ).toBe("New route — staying off interstates.");
  });

  it("stays quiet on screen for a silent update, but still names the rule in voice", () => {
    const silent = offRouteReplanCopy({ kind: "no_interstate", silent: true, hasAlternate: false });
    expect(silent.hint).toBeNull();
    expect(silent.voice).toBe("Updating — staying off interstates.");
  });
});
