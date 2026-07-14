import { describe, expect, it } from "vitest";
import {
  programmaticCameraOverridesExploreLatch,
  routeLineGeometryKind,
  shouldClearExploreLatchOnViewSwitch,
  shouldFitFullRouteCorridor,
  shouldFollowPuckTopdown,
  shouldForceTopdownStreetZoomOnEnter,
  shouldUseDriveFollowCamera,
  showsAlternateLegs,
  showsRadarMotionOverlay,
  showsRouteConditionHighlights,
  viewModePhase,
} from "../viewModeContract";

describe("viewModeContract — phase", () => {
  it("maps navigationStarted to phase", () => {
    expect(viewModePhase(true)).toBe("navigating");
    expect(viewModePhase(false)).toBe("planning");
  });
});

describe("viewModeContract — camera framing", () => {
  it("only Rt fits the full route while navigating", () => {
    expect(shouldFitFullRouteCorridor("route", true)).toBe(true);
    expect(shouldFitFullRouteCorridor("topdown", true)).toBe(false);
    expect(shouldFitFullRouteCorridor("drive", true)).toBe(false);
  });

  it("Mp never fits the full trip while navigating", () => {
    expect(shouldFitFullRouteCorridor("topdown", true)).toBe(false);
    expect(shouldFollowPuckTopdown("topdown", true)).toBe(true);
  });

  it("Dr uses its own follow camera; other views must not", () => {
    expect(shouldUseDriveFollowCamera("drive", true)).toBe(true);
    expect(shouldUseDriveFollowCamera("topdown", true)).toBe(false);
    expect(shouldUseDriveFollowCamera("route", true)).toBe(false);
  });

  it("planning never fits the whole trip or follows the drive cam", () => {
    expect(shouldFitFullRouteCorridor("route", false)).toBe(false);
    expect(shouldFollowPuckTopdown("topdown", false)).toBe(false);
    expect(shouldUseDriveFollowCamera("drive", false)).toBe(false);
  });

  it("entering Mp from Rt forces a street-zoom re-home", () => {
    expect(shouldForceTopdownStreetZoomOnEnter("route", "topdown", true)).toBe(true);
    expect(shouldForceTopdownStreetZoomOnEnter("drive", "topdown", true)).toBe(true);
    expect(shouldForceTopdownStreetZoomOnEnter(null, "topdown", true)).toBe(true);
  });

  it("staying in Mp does not re-force street zoom on every render", () => {
    expect(shouldForceTopdownStreetZoomOnEnter("topdown", "topdown", true)).toBe(false);
  });

  it("does not force Mp street zoom while planning", () => {
    expect(shouldForceTopdownStreetZoomOnEnter("route", "topdown", false)).toBe(false);
  });
});

describe("viewModeContract — route line geometry", () => {
  it("Dr uses the ahead slice when navigating with a known along offset", () => {
    expect(
      routeLineGeometryKind("drive", true, { userAlongMeters: 12_500 })
    ).toBe("driveAhead");
  });

  it("Mp keeps the full overview polyline while navigating (regression: prevents Dr stub in Mp)", () => {
    expect(
      routeLineGeometryKind("topdown", true, { userAlongMeters: 12_500 })
    ).toBe("overview");
  });

  it("Rt always uses the full overview polyline", () => {
    expect(routeLineGeometryKind("route", true, { userAlongMeters: 12_500 })).toBe(
      "overview"
    );
    expect(routeLineGeometryKind("route", false)).toBe("overview");
  });

  it("Dr falls back to overview when the along offset is missing", () => {
    expect(routeLineGeometryKind("drive", true, { userAlongMeters: null })).toBe(
      "overview"
    );
    expect(routeLineGeometryKind("drive", true)).toBe("overview");
  });

  it("planning uses overview in every view", () => {
    expect(routeLineGeometryKind("drive", false, { userAlongMeters: 12_500 })).toBe(
      "overview"
    );
    expect(routeLineGeometryKind("topdown", false)).toBe("overview");
  });

  it("corner PiP always uses overview regardless of underlying view", () => {
    expect(
      routeLineGeometryKind("drive", true, {
        userAlongMeters: 12_500,
        isOverviewPip: true,
      })
    ).toBe("overview");
  });
});

describe("viewModeContract — explore latch", () => {
  it("app-driven refits override the explore latch", () => {
    expect(programmaticCameraOverridesExploreLatch("viewModeSwitch")).toBe(true);
    expect(programmaticCameraOverridesExploreLatch("reroute")).toBe(true);
    expect(programmaticCameraOverridesExploreLatch("slotChange")).toBe(true);
    expect(programmaticCameraOverridesExploreLatch("navigationStart")).toBe(true);
    expect(programmaticCameraOverridesExploreLatch("navigationStop")).toBe(true);
    expect(programmaticCameraOverridesExploreLatch("styleReload")).toBe(true);
  });

  it("passive GPS ticks respect the explore latch", () => {
    expect(programmaticCameraOverridesExploreLatch("gpsTick")).toBe(false);
  });

  it("switching views clears the previous latch", () => {
    expect(shouldClearExploreLatchOnViewSwitch("route", "topdown")).toBe(true);
    expect(shouldClearExploreLatchOnViewSwitch("topdown", "drive")).toBe(true);
    expect(shouldClearExploreLatchOnViewSwitch(null, "topdown")).toBe(true);
  });

  it("staying in the same view keeps the latch", () => {
    expect(shouldClearExploreLatchOnViewSwitch("topdown", "topdown")).toBe(false);
  });
});

describe("viewModeContract — overlays", () => {
  it("shows alternates in Rt and Mp while navigating; Dr locked-only", () => {
    expect(showsAlternateLegs("route", true)).toBe(true);
    expect(showsAlternateLegs("topdown", true)).toBe(true);
    expect(showsAlternateLegs("drive", true)).toBe(false);
  });

  it("shows alternates in every view while planning", () => {
    expect(showsAlternateLegs("drive", false)).toBe(true);
    expect(showsAlternateLegs("route", false)).toBe(true);
    expect(showsAlternateLegs("topdown", false)).toBe(true);
  });

  it("condition halos render in Rt + Mp; Dr uses the ahead slice for its own halos", () => {
    expect(showsRouteConditionHighlights("route", true)).toBe(true);
    expect(showsRouteConditionHighlights("topdown", true)).toBe(true);
    expect(showsRouteConditionHighlights("drive", true)).toBe(false);
  });

  it("radar motion overlay is visible in every navigating view", () => {
    expect(showsRadarMotionOverlay("route", true)).toBe(true);
    expect(showsRadarMotionOverlay("topdown", true)).toBe(true);
    expect(showsRadarMotionOverlay("drive", true)).toBe(true);
  });

  it("radar motion overlay hides in Dr while planning (no active nav)", () => {
    expect(showsRadarMotionOverlay("drive", false)).toBe(false);
    expect(showsRadarMotionOverlay("route", false)).toBe(true);
    expect(showsRadarMotionOverlay("topdown", false)).toBe(true);
  });
});
