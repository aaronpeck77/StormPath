import { describe, expect, it } from "vitest";
import { allowFollowCamJumpToFallback } from "../mapLowSignalResilience";
import { driveFollowCamAllowsSetCenterHotLoop } from "../driveFollowCamWrite";
import {
  isMapReadyForFollowCam,
  isMapUsable,
  safeHardFollowCamera,
  safeJumpTo,
  safePanToCenter,
} from "../mapCameraSafe";
import type { Map } from "mapbox-gl";

/**
 * Regression notes for Wi‑Fi→cell freeze:
 * - Follow-cam must not require Mapbox `isStyleLoaded()` (sources stay "loading" on failed tiles).
 * - Healthy Drive follow still uses yard-line pan — not a 60fps setCenter.
 * - Hold / stalled follow uses hard setters so easeTo queues cannot freeze the map.
 */
function mockFollowMap(opts?: { styleLoaded?: boolean; connected?: boolean; jumpThrows?: boolean }) {
  const state = {
    center: [0, 0] as [number, number],
    zoom: 14,
    bearing: 0,
    pitch: 0,
    stopped: 0,
    jumpCalls: 0,
    easeCalls: 0,
  };
  const map = {
    getContainer: () => ({ isConnected: opts?.connected !== false }),
    isStyleLoaded: () => opts?.styleLoaded === true,
    stop: () => {
      state.stopped += 1;
    },
    setCenter: (c: [number, number]) => {
      state.center = c;
    },
    setZoom: (z: number) => {
      state.zoom = z;
    },
    setBearing: (b: number) => {
      state.bearing = b;
    },
    setPitch: (p: number) => {
      state.pitch = p;
    },
    getZoom: () => state.zoom,
    getPitch: () => state.pitch,
    getBearing: () => state.bearing,
    jumpTo: (next: { center?: [number, number]; zoom?: number; bearing?: number; pitch?: number }) => {
      state.jumpCalls += 1;
      if (opts?.jumpThrows) throw new Error("style worker teardown");
      if (next.center) state.center = next.center;
      if (typeof next.zoom === "number") state.zoom = next.zoom;
      if (typeof next.bearing === "number") state.bearing = next.bearing;
      if (typeof next.pitch === "number") state.pitch = next.pitch;
    },
    easeTo: () => {
      state.easeCalls += 1;
    },
  };
  return { map: map as unknown as Map, state };
}

describe("wifi-to-cell follow cam contract", () => {
  it("allows hard camera repair when follow is stalled under dead-zone hold", () => {
    expect(
      allowFollowCamJumpToFallback({
        intentionalResync: false,
        holdLastGoodMap: true,
        gpsFollowStalled: true,
      })
    ).toBe(true);
  });

  it("does not use setCenter on the healthy Drive RAF loop", () => {
    expect(driveFollowCamAllowsSetCenterHotLoop()).toBe(false);
  });

  it("keeps follow-cam ready when Mapbox style is still loading tiles", () => {
    const { map } = mockFollowMap({ styleLoaded: false, connected: true });
    expect(isMapUsable(map)).toBe(true);
    expect(isMapReadyForFollowCam(map)).toBe(true);
    expect(map.isStyleLoaded()).toBe(false);
  });

  it("does not easeTo when style is loading — pan stays blocked, hard follow still writes", () => {
    const { map, state } = mockFollowMap({ styleLoaded: false, connected: true });
    expect(
      safePanToCenter(map, {
        center: [-86.78, 36.16],
        zoom: 16,
        pitch: 50,
        bearing: 90,
        duration: 0,
        essential: true,
      })
    ).toBe(false);
    expect(state.easeCalls).toBe(0);
    expect(
      safeHardFollowCamera(map, {
        center: [-86.78, 36.16],
        zoom: 16,
        pitch: 50,
        bearing: 90,
      })
    ).toBe(true);
    expect(state.center).toEqual([-86.78, 36.16]);
    expect(state.zoom).toBe(16);
    expect(state.bearing).toBe(90);
    expect(state.pitch).toBe(50);
  });

  it("jumpTo works without isStyleLoaded and falls back to hard setters if jump throws", () => {
    const ok = mockFollowMap({ styleLoaded: false, connected: true });
    expect(
      safeJumpTo(ok.map, {
        center: [-86.8, 36.2],
        zoom: 15,
        pitch: 48,
        bearing: 12,
      })
    ).toBe(true);
    expect(ok.state.jumpCalls).toBe(1);
    expect(ok.state.center).toEqual([-86.8, 36.2]);

    const broken = mockFollowMap({ styleLoaded: false, connected: true, jumpThrows: true });
    expect(
      safeJumpTo(broken.map, {
        center: [-87, 36],
        zoom: 17,
        pitch: 40,
        bearing: 180,
      })
    ).toBe(true);
    expect(broken.state.center).toEqual([-87, 36]);
    expect(broken.state.zoom).toBe(17);
    expect(broken.state.bearing).toBe(180);
    expect(broken.state.pitch).toBe(40);
  });
});
