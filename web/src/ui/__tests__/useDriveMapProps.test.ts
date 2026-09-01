import { describe, expect, it, vi } from "vitest";
import type { MutableRefObject } from "react";
import type { LngLat } from "../../nav/types";
import { buildDriveMapProps, type UseDriveMapPropsInput } from "../useDriveMapProps";

function ref<T>(v: T): MutableRefObject<T> {
  return { current: v };
}

function baseInput(over: Partial<UseDriveMapPropsInput> = {}): UseDriveMapPropsInput {
  return {
    routes: [],
    lineFocusId: "r-a",
    suggestedRouteId: null,
    userLngLat: [-88.9, 39.8],
    navigationStarted: true,
    liveLngLatRef: ref<LngLat | null>([-88.9, 39.8]),
    liveSpeedMpsRef: ref<number | null>(12),
    liveHeadingRef: ref<number | null>(90),
    destLngLat: [-87.6, 41.8],
    viaStops: [],
    fitTrigger: 1,
    viewMode: "drive",
    heading: 90,
    driveRouteBearingDeg: 95,
    driveOffRouteForwardFraming: false,
    followingTemporaryGuidance: false,
    speedMps: 12,
    allowDestinationPick: false,
    topdownZoomRef: ref(13.5),
    onMapClick: vi.fn(),
    savedPlaces: [],
    savedPlacesVisible: false,
    onSavedPlaceClick: vi.fn(),
    mapFocus: null,
    onMapFocusComplete: vi.fn(),
    orderedRouteIds: ["r-a"],
    radarMapOverlayOn: true,
    settingRadarDisplayMode: "motion",
    dataSaverMode: false,
    navMapLiteMode: false,
    isOnline: true,
    onRadarFrameUtcSec: vi.fn(),
    alongRouteAlerts: [],
    corridorRouteGeometry: [
      [-88.9, 39.8],
      [-87.6, 41.8],
    ],
    stormAlongRouteBands: [],
    recordingActive: false,
    recordingPathPreview: [],
    weatherAlertGeoJson: null,
    stormBarVisible: true,
    stormBarExpanded: false,
    recenterPlanningPuckTick: 0,
    navigationGuidanceGeometry: [
      [-88.9, 39.8],
      [-87.6, 41.8],
    ],
    navPositionOnRoute: true,
    userAlongGuidanceM: 1200,
    isPlus: true,
    settingTrafficEnabled: true,
    hasMapboxToken: true,
    onDriveCameraBearingDeg: vi.fn(),
    trafficBypassCompare: null,
    lockedNavigationRouteId: "r-a",
    activityTrailGeoJson: null,
    guidanceRouteLengthM: 50_000,
    maxPlanRouteLengthM: 50_000,
    activityTrailPlanningBounds: null,
    idleHomeMapFraming: "my_location",
    homePuckFollow: "follow",
    idleHomeNoRoutes: false,
    setHomePuckFollow: vi.fn(),
    learnEnabled: true,
    homePreloadEnabled: false,
    homePreloadBounds: null,
    searchPickMarkers: null,
    onSearchPickMarkerClick: undefined,
    progressRailVisible: true,
    offRouteRejoinCompareActive: false,
    ...over,
  };
}

describe("buildDriveMapProps", () => {
  it("assembles puck snap from guidance geometry while on route", () => {
    const props = buildDriveMapProps(baseInput(), vi.fn());
    expect(props.puckSnapEnabled).toBe(true);
    expect(props.puckSnapGeometry).toHaveLength(2);
    expect(props.userAlongMeters).toBe(1200);
    expect(props.driveLoopEpoch).toBe(0);
    expect(props.liveGpsLngLatRef).toBeDefined();
  });

  it("drops live GPS refs and puck snap when not navigating", () => {
    const props = buildDriveMapProps(baseInput({ navigationStarted: false }), vi.fn());
    expect(props.liveGpsLngLatRef).toBeUndefined();
    expect(props.puckSnapEnabled).toBe(false);
    expect(props.puckSnapGeometry).toBeNull();
    expect(props.userAlongMeters).toBeNull();
  });

  it("enables traffic overlay only for Plus + road detail + traffic + token", () => {
    expect(buildDriveMapProps(baseInput(), vi.fn()).trafficConditionsOnMap).toBe(true);
    expect(
      buildDriveMapProps(baseInput({ isPlus: false }), vi.fn()).trafficConditionsOnMap
    ).toBe(false);
  });

  it("animates radar only in motion mode outside data-saver", () => {
    const motion = buildDriveMapProps(baseInput(), vi.fn());
    expect(motion.radarAnimate).toBe(true);
    expect(motion.radarStormMotionArrows).toBe(false);

    const still = buildDriveMapProps(
      baseInput({ settingRadarDisplayMode: "still_arrows" }),
      vi.fn()
    );
    expect(still.radarAnimate).toBe(false);
    expect(still.radarStormMotionArrows).toBe(true);

    const saver = buildDriveMapProps(baseInput({ dataSaverMode: true }), vi.fn());
    expect(saver.radarAnimate).toBe(false);
  });

  it("mirrors rejoin overlay from the off-route hold flag", () => {
    const props = buildDriveMapProps(
      baseInput({ offRouteRejoinCompareActive: true }),
      vi.fn()
    );
    expect(props.offRouteRejoinCompareActive).toBe(true);
    expect(props.rejoinOverlayActive).toBe(true);
  });

  it("forwards the home-pan callback unchanged", () => {
    const onHomeMapUserPan = vi.fn();
    const props = buildDriveMapProps(baseInput(), onHomeMapUserPan);
    props.onHomeMapUserPan?.();
    expect(onHomeMapUserPan).toHaveBeenCalledOnce();
  });
});
