import { describe, expect, it } from "vitest";
import {
  DEST_PLACE_MIN_ZOOM,
  PIN_PLACE_EXPLORE_IDLE_MS,
  destPlaceHoldCenter,
  destPlaceHoldZoom,
  destPlaceNeedsStreetRestore,
  destPlaceRejectsRegionalZoom,
  destPlaceWaitCenter,
  exploreIdleMsForPinPlacing,
  isPlanningPinPlacing,
  shouldHoldDestPlaceFrame,
} from "../destPlaceCamera";
import {
  ROUTE_VIEW_PLANNING_STREET_ZOOM,
  ROUTE_VIEW_REGIONAL_ZOOM,
  ROUTE_VIEW_REGIONAL_ZOOM_PHONE,
} from "../mapTopdownCamera";

describe("destPlaceCamera", () => {
  it("treats a just-tapped dest with no routes as a hold, not home follow", () => {
    expect(
      shouldHoldDestPlaceFrame({
        destLngLat: [-86.78, 36.16],
        routesLength: 0,
        navigationStarted: false,
      })
    ).toBe(true);
  });

  it("releases the hold once a plan exists or Go has started", () => {
    expect(
      shouldHoldDestPlaceFrame({
        destLngLat: [-86.78, 36.16],
        routesLength: 1,
        navigationStarted: false,
      })
    ).toBe(false);
    expect(
      shouldHoldDestPlaceFrame({
        destLngLat: [-86.78, 36.16],
        routesLength: 0,
        navigationStarted: true,
      })
    ).toBe(false);
  });

  /**
   * Regression: the pinch-out floor used to key on "no routes", which locked an empty
   * map at DEST_PLACE_MIN_ZOOM — you could not zoom out past a small city to see weather.
   */
  it("does not hold the frame when no pin has been dropped", () => {
    expect(
      shouldHoldDestPlaceFrame({
        destLngLat: null,
        routesLength: 0,
        navigationStarted: false,
      })
    ).toBe(false);
    expect(
      shouldHoldDestPlaceFrame({
        destLngLat: undefined,
        routesLength: 0,
        navigationStarted: false,
      })
    ).toBe(false);
  });

  it("snaps Canada / Rt regional zoom back to street, keeping a street tap", () => {
    expect(destPlaceHoldZoom(ROUTE_VIEW_REGIONAL_ZOOM)).toBe(ROUTE_VIEW_PLANNING_STREET_ZOOM);
    expect(destPlaceHoldZoom(ROUTE_VIEW_REGIONAL_ZOOM_PHONE)).toBe(ROUTE_VIEW_PLANNING_STREET_ZOOM);
    expect(destPlaceHoldZoom(4)).toBe(ROUTE_VIEW_PLANNING_STREET_ZOOM);
    expect(destPlaceHoldZoom(14.2)).toBe(14.2);
    expect(destPlaceNeedsStreetRestore(6.95)).toBe(true);
    expect(destPlaceNeedsStreetRestore(14.2)).toBe(false);
    expect(DEST_PLACE_MIN_ZOOM).toBeGreaterThan(ROUTE_VIEW_REGIONAL_ZOOM);
  });

  it("rejects the regional Canada zoom as a dest-place target", () => {
    expect(destPlaceRejectsRegionalZoom(ROUTE_VIEW_REGIONAL_ZOOM)).toBe(true);
    expect(destPlaceRejectsRegionalZoom(ROUTE_VIEW_PLANNING_STREET_ZOOM)).toBe(false);
  });

  it("treats home / unrouted dest-pick as pin placing", () => {
    expect(isPlanningPinPlacing({ routesLength: 0, navigationStarted: false })).toBe(true);
    expect(isPlanningPinPlacing({ routesLength: 1, navigationStarted: false })).toBe(false);
    expect(isPlanningPinPlacing({ routesLength: 0, navigationStarted: true })).toBe(false);
  });

  it("does not street-zoom a continent midpoint while the plan is thinking", () => {
    const puck: [number, number] = [-86.78, 36.16];
    const dest: [number, number] = [-87.63, 41.88];
    const midwest: [number, number] = [-92.2, 38.6];
    expect(
      destPlaceHoldCenter({
        mapCenter: midwest,
        userLngLat: puck,
        destLngLat: dest,
        mapZoom: ROUTE_VIEW_REGIONAL_ZOOM,
      })
    ).toEqual(puck);
    expect(
      destPlaceWaitCenter({
        mapCenter: midwest,
        userLngLat: puck,
        destLngLat: dest,
        mapZoom: 14.2,
      })
    ).toEqual(puck);
  });

  it("keeps a street dest tap on the pin", () => {
    const dest: [number, number] = [-87.63, 41.88];
    expect(
      destPlaceWaitCenter({
        mapCenter: dest,
        userLngLat: [-86.78, 36.16],
        destLngLat: dest,
        mapZoom: 14.2,
      })
    ).toEqual(dest);
  });

  it("does not snap home follow back 400ms after a dest-pick pinch", () => {
    expect(exploreIdleMsForPinPlacing(true, 400)).toBe(PIN_PLACE_EXPLORE_IDLE_MS);
    expect(exploreIdleMsForPinPlacing(true, 400)).toBeGreaterThan(1000);
    expect(exploreIdleMsForPinPlacing(false, 400)).toBe(400);
  });
});
