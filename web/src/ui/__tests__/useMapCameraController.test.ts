import { describe, expect, it } from "vitest";
import {
  refitOverridesExploreLatch,
  requiresFullRouteFit,
  resolveViewEnterDecision,
  topdownFitNeedsStreetZoomReset,
} from "../useMapCameraController";
import type { Map as MapboxMap } from "mapbox-gl";
import type { MutableRefObject } from "react";

function fakeMap(zoom: number): MapboxMap {
  return { getZoom: () => zoom } as unknown as MapboxMap;
}

function ref(v: number): MutableRefObject<number> {
  return { current: v };
}

describe("useMapCameraController — view-enter decisions", () => {
  it("entering Rt from Mp busts route snap keys and clears explore latch", () => {
    const d = resolveViewEnterDecision({
      prevViewMode: "topdown",
      nextViewMode: "route",
      navigationStarted: true,
    });
    expect(d.enteredRouteView).toBe(true);
    expect(d.enteredTopdownNav).toBe(false);
    expect(d.clearExploreLatch).toBe(true);
    expect(d.bustRouteOverviewSnapKey).toBe(true);
    expect(d.resetPlanningFitTrigger).toBe(true);
  });

  it("entering Mp from Rt while navigating forces topdown street-zoom re-home (Mp regression)", () => {
    const d = resolveViewEnterDecision({
      prevViewMode: "route",
      nextViewMode: "topdown",
      navigationStarted: true,
    });
    expect(d.enteredTopdownNav).toBe(true);
    expect(d.bustTopdownSnapKey).toBe(true);
    expect(d.clearExploreLatch).toBe(true);
  });

  it("staying in Mp does not re-force the topdown re-home", () => {
    const d = resolveViewEnterDecision({
      prevViewMode: "topdown",
      nextViewMode: "topdown",
      navigationStarted: true,
    });
    expect(d.enteredTopdownNav).toBe(false);
    expect(d.clearExploreLatch).toBe(false);
    expect(d.bustTopdownSnapKey).toBe(false);
  });

  it("first-ever mount (prev null) into Mp forces re-home so we do not inherit stale zoom", () => {
    const d = resolveViewEnterDecision({
      prevViewMode: null,
      nextViewMode: "topdown",
      navigationStarted: true,
    });
    expect(d.enteredTopdownNav).toBe(true);
    expect(d.bustTopdownSnapKey).toBe(true);
  });

  it("planning does not force topdown re-home", () => {
    const d = resolveViewEnterDecision({
      prevViewMode: "route",
      nextViewMode: "topdown",
      navigationStarted: false,
    });
    expect(d.enteredTopdownNav).toBe(false);
  });
});

describe("useMapCameraController — explore latch overrides", () => {
  it("reroute, slot change, view switch, and style reload override the latch", () => {
    expect(refitOverridesExploreLatch("reroute")).toBe(true);
    expect(refitOverridesExploreLatch("slotChange")).toBe(true);
    expect(refitOverridesExploreLatch("viewModeSwitch")).toBe(true);
    expect(refitOverridesExploreLatch("styleReload")).toBe(true);
  });

  it("plain GPS ticks respect the latch", () => {
    expect(refitOverridesExploreLatch("gpsTick")).toBe(false);
  });
});

describe("useMapCameraController — full-route fit", () => {
  it("Rt while navigating requires a full-route fit", () => {
    expect(requiresFullRouteFit("route", true)).toBe(true);
  });

  it("Mp/Dr while navigating never fit the full route", () => {
    expect(requiresFullRouteFit("topdown", true)).toBe(false);
    expect(requiresFullRouteFit("drive", true)).toBe(false);
  });

  it("planning always fits the full trip (initial framing)", () => {
    expect(requiresFullRouteFit("route", false)).toBe(true);
    expect(requiresFullRouteFit("topdown", false)).toBe(true);
    expect(requiresFullRouteFit("drive", false)).toBe(true);
  });
});

describe("useMapCameraController — topdown zoom reset", () => {
  it("forces reset when we just entered Mp from another view", () => {
    expect(
      topdownFitNeedsStreetZoomReset({
        map: fakeMap(13.5),
        topdownZoomRef: ref(13.5),
        enteredTopdownNav: true,
      })
    ).toBe(true);
  });

  it("forces reset when map zoom drifted below the nav min zoom (Rt continent zoom leak)", () => {
    expect(
      topdownFitNeedsStreetZoomReset({
        map: fakeMap(6.9),
        topdownZoomRef: ref(13.5),
        enteredTopdownNav: false,
      })
    ).toBe(true);
  });

  it("no reset when already at a valid Mp zoom", () => {
    expect(
      topdownFitNeedsStreetZoomReset({
        map: fakeMap(14.5),
        topdownZoomRef: ref(14.5),
        enteredTopdownNav: false,
      })
    ).toBe(false);
  });
});
