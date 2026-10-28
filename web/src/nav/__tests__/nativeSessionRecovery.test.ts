import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  listeners: new Map<string, (event: any) => void>(),
  bump: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (value: unknown) => [value, vi.fn()],
  useRef: (value: unknown) => ({ current: value }),
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => unknown) => { effect(); },
}));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => "ios" } }));
vi.mock("@stormpath/mapbox-navigation", () => ({ StormpathMapboxNavigation: {
  isAvailable: async () => ({ available: true }),
  addListener: async (name: string, callback: (event: any) => void) => {
    mock.listeners.set(name, callback);
    return { remove: async () => undefined };
  },
  startActiveGuidance: async () => ({ ok: true }),
  stop: async () => undefined,
  setVoiceGuidance: async () => undefined,
} }));
vi.mock("../driveDiagnostics", () => ({ bumpDriveDiag: mock.bump, noteDriveDiagRouteLock: vi.fn(), resetDriveDiag: vi.fn() }));
vi.mock("../../monitoring/mapboxUsageMeter", () => ({ recordMapboxUsage: vi.fn() }));
vi.mock("../offlineTripPacks", () => ({ downloadTripCorridor: vi.fn(), removeTripCorridor: vi.fn() }));

import { useNativeNavSession } from "../useNativeNavSession";

const route = {
  geometry: [{ lng: -90, lat: 40 }, { lng: -90, lat: 40.01 }],
  turnSteps: [{ instruction: "Continue north", distanceM: 1000 }],
};
const progress = { lng: -90, lat: 40.001, alongM: 100, remainingM: 900, stepIndex: 0, instruction: "Continue north" };

describe("native session recovery", () => {
  beforeEach(() => { mock.listeners.clear(); mock.bump.mockClear(); });

  it("resumes Core progress after a rejected reroute is followed by an accepted corridor", async () => {
    const adopt = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false).mockReturnValue(true);
    const session = useNativeNavSession({ accessToken: "test", navigationStarted: true,
      coords: { userLngLat: [-90, 40], destLngLat: [-90, 40.01], viaStops: [] }, onRouteGeometry: adopt });
    await vi.waitFor(() => expect(mock.listeners.has("routeChanged")).toBe(true));
    const changed = mock.listeners.get("routeChanged")!;
    const tick = mock.listeners.get("progress")!;
    changed(route);
    tick(progress);
    expect(mock.bump).toHaveBeenCalledTimes(1);
    changed(route);
    tick(progress);
    expect(mock.bump).toHaveBeenCalledTimes(1);
    expect(session.coreRerouteHealthRef.current.abandoned).toBe(true);
    changed(route);
    tick(progress);
    expect(session.coreRerouteHealthRef.current.abandoned).toBe(false);
    expect(mock.bump).toHaveBeenCalledTimes(2);
    adopt.mockReturnValueOnce(false).mockReturnValue(true);
    changed(route);
    tick(progress);
    expect(mock.bump).toHaveBeenCalledTimes(2);
    changed(route);
    tick(progress);
    expect(mock.bump).toHaveBeenCalledTimes(3);
  });
});
