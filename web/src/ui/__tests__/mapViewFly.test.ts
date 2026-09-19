import { describe, expect, it } from "vitest";
import {
  MAP_VIEW_FLY_MAX_MS,
  MAP_VIEW_FLY_MS,
  MAP_VIEW_FLY_OVERVIEW_MS,
  droneLookAtScreen,
  droneTiltT,
  lerpMapDronePose,
  mapDroneDurationMs,
  mapViewFlySkipReason,
  shouldAnimateMapViewFly,
  shouldTrackPuckThroughDrone,
} from "../mapViewFly";

describe("shouldAnimateMapViewFly", () => {
  it("flies between the three map poses", () => {
    expect(
      shouldAnimateMapViewFly({ prevViewMode: "drive", nextViewMode: "topdown" })
    ).toBe(true);
    expect(shouldAnimateMapViewFly({ prevViewMode: "topdown", nextViewMode: "route" })).toBe(
      true
    );
    expect(shouldAnimateMapViewFly({ prevViewMode: "route", nextViewMode: "drive" })).toBe(
      true
    );
    expect(shouldAnimateMapViewFly({ prevViewMode: "drive", nextViewMode: "route" })).toBe(
      true
    );
    expect(MAP_VIEW_FLY_MS).toBeGreaterThan(500);
    expect(MAP_VIEW_FLY_MS).toBeLessThanOrEqual(MAP_VIEW_FLY_MAX_MS);
  });

  it("jumps on first paint, same view, dest-hold, or compare", () => {
    expect(shouldAnimateMapViewFly({ prevViewMode: null, nextViewMode: "drive" })).toBe(false);
    expect(mapViewFlySkipReason({ prevViewMode: null, nextViewMode: "drive" })).toBe("first");
    expect(
      shouldAnimateMapViewFly({ prevViewMode: "drive", nextViewMode: "drive" })
    ).toBe(false);
    expect(mapViewFlySkipReason({ prevViewMode: "drive", nextViewMode: "drive" })).toBe("same");
    expect(
      shouldAnimateMapViewFly({
        prevViewMode: "drive",
        nextViewMode: "route",
        destPlaceHold: true,
      })
    ).toBe(false);
    expect(
      mapViewFlySkipReason({
        prevViewMode: "drive",
        nextViewMode: "route",
        destPlaceHold: true,
      })
    ).toBe("hold");
    expect(
      shouldAnimateMapViewFly({
        prevViewMode: "drive",
        nextViewMode: "topdown",
        offRouteCompare: true,
      })
    ).toBe(false);
    expect(
      mapViewFlySkipReason({
        prevViewMode: "drive",
        nextViewMode: "topdown",
        offRouteCompare: true,
      })
    ).toBe("compare");
  });

  it("still flies after a pinch/pan — the shot starts from wherever they were looking", () => {
    expect(
      shouldAnimateMapViewFly({ prevViewMode: "topdown", nextViewMode: "route" })
    ).toBe(true);
    expect(
      shouldAnimateMapViewFly({ prevViewMode: "route", nextViewMode: "drive" })
    ).toBe(true);
  });
});

describe("shouldTrackPuckThroughDrone", () => {
  it("keeps the puck in Dr and Mp, pans out for Rt", () => {
    expect(shouldTrackPuckThroughDrone("drive")).toBe(true);
    expect(shouldTrackPuckThroughDrone("topdown")).toBe(true);
    expect(shouldTrackPuckThroughDrone("route")).toBe(false);
  });
});

describe("lerpMapDronePose", () => {
  const pad = { top: 0, bottom: 0, left: 0, right: 0 };
  const from = {
    lng: -90,
    lat: 38,
    zoom: 16,
    pitch: 68,
    bearing: 350,
    padding: pad,
    offset: [0, 120] as [number, number],
  };
  const to = {
    lng: -90.2,
    lat: 38.2,
    zoom: 8,
    pitch: 0,
    bearing: 10,
    padding: pad,
    offset: [0, 0] as [number, number],
  };

  it("starts on the live camera — never teleports the first frame", () => {
    const start = lerpMapDronePose(from, to, 0);
    expect(start.lng).toBe(from.lng);
    expect(start.lat).toBe(from.lat);
    expect(start.zoom).toBe(from.zoom);
    expect(start.pitch).toBe(from.pitch);
    expect(start.offset[1]).toBe(from.offset[1]);
  });

  it("lands on the target pose", () => {
    const end = lerpMapDronePose(from, to, 1);
    expect(end.lng).toBe(to.lng);
    expect(end.lat).toBe(to.lat);
    expect(end.zoom).toBe(to.zoom);
    expect(end.pitch).toBe(to.pitch);
    expect(end.bearing).toBeCloseTo(10, 5);
  });

  it("does not reverse zoom (no flyTo zoom-out-then-in)", () => {
    const a = lerpMapDronePose(from, to, 0.25);
    const b = lerpMapDronePose(from, to, 0.5);
    const c = lerpMapDronePose(from, to, 0.75);
    expect(a.zoom).toBeLessThan(from.zoom);
    expect(b.zoom).toBeLessThan(a.zoom);
    expect(c.zoom).toBeLessThan(b.zoom);
    expect(c.zoom).toBeGreaterThan(to.zoom);
  });

  it("takes the short bearing turn", () => {
    const mid = lerpMapDronePose(from, to, 0.5);
    expect(mid.bearing).toBeCloseTo(0, 5);
  });

  it("pans continuously toward the target — no first-frame leap to the puck", () => {
    const overview = {
      lng: -90,
      lat: 38,
      zoom: 7.5,
      pitch: 0,
      bearing: 0,
      padding: pad,
      offset: [0, 0] as [number, number],
    };
    const drive = {
      lng: -90.4,
      lat: 38.5,
      zoom: 16.6,
      pitch: 68,
      bearing: 90,
      padding: { top: 172, bottom: 156, left: 104, right: 104 },
      offset: [0, 220] as [number, number],
    };
    const early = lerpMapDronePose(overview, drive, 0.05);
    expect(Math.abs(early.lng - overview.lng)).toBeLessThan(Math.abs(drive.lng - overview.lng) * 0.2);
    expect(early.lng).not.toBe(drive.lng);
    expect(early.lat).not.toBe(drive.lat);
  });

  it("swings past the puck on the way to Drive without leaping on frame 0", () => {
    const overview = {
      lng: -90,
      lat: 38,
      zoom: 7.5,
      pitch: 0,
      bearing: 0,
      padding: pad,
      offset: [0, 0] as [number, number],
    };
    const drive = {
      lng: -90.05,
      lat: 38.05,
      zoom: 16.6,
      pitch: 68,
      bearing: 90,
      padding: pad,
      offset: [0, 220] as [number, number],
    };
    const puck = { lng: -90.4, lat: 38.5 };
    const start = lerpMapDronePose(overview, drive, 0, puck);
    expect(start.lng).toBe(overview.lng);
    expect(start.lat).toBe(overview.lat);
    const mid = lerpMapDronePose(overview, drive, 0.35, puck);
    const linear = lerpMapDronePose(overview, drive, 0.35);
    expect(Math.abs(mid.lng - puck.lng)).toBeLessThan(Math.abs(linear.lng - puck.lng));
    const end = lerpMapDronePose(overview, drive, 1, puck);
    expect(end.lng).toBe(drive.lng);
    expect(end.lat).toBe(drive.lat);
  });

  it("climbs out to Route over the car, then trucks — no centroid smear", () => {
    const drive = {
      lng: -90.4,
      lat: 38.5,
      zoom: 16.6,
      pitch: 68,
      bearing: 90,
      padding: pad,
      offset: [0, 220] as [number, number],
    };
    const route = {
      lng: -91.2,
      lat: 37.4,
      zoom: 8,
      pitch: 0,
      bearing: 0,
      padding: pad,
      offset: [0, 0] as [number, number],
    };
    const puck = { lng: -90.4, lat: 38.5 };
    const start = lerpMapDronePose(drive, route, 0, puck);
    expect(start.lng).toBe(drive.lng);
    expect(start.lat).toBe(drive.lat);
    const climb = lerpMapDronePose(drive, route, 0.3, puck);
    const smearLng = drive.lng + (route.lng - drive.lng) * 0.3;
    expect(Math.abs(climb.lng - drive.lng)).toBeLessThan(0.05);
    expect(Math.abs(climb.lng - drive.lng)).toBeLessThan(Math.abs(smearLng - drive.lng));
    expect(climb.zoom).toBeLessThan(drive.zoom);
    expect(climb.pitch).toBeLessThan(drive.pitch);
    const end = lerpMapDronePose(drive, route, 1, puck);
    expect(end.lng).toBe(route.lng);
    expect(end.lat).toBe(route.lat);
  });
});

describe("drone motion", () => {
  const pad = { top: 0, bottom: 0, left: 0, right: 0 };
  const overview = {
    lng: -90,
    lat: 38,
    zoom: 8,
    pitch: 0,
    bearing: 0,
    padding: pad,
    offset: [0, 0] as [number, number],
  };
  const drive = {
    lng: -90.1,
    lat: 38.1,
    zoom: 16.6,
    pitch: 68,
    bearing: 40,
    padding: pad,
    offset: [0, 200] as [number, number],
  };

  it("moves pitch with zoom so the first third is not a hang", () => {
    const early = lerpMapDronePose(overview, drive, 0.22);
    expect(early.pitch).toBeGreaterThan(10);
    expect(early.zoom).toBeGreaterThan(overview.zoom + 1);
    expect(droneTiltT(overview, drive, 0.22)).toBeCloseTo(0.22);
  });

  it("gives Route hops more time than a Dr↔Mp rotate", () => {
    expect(mapDroneDurationMs(overview, drive)).toBe(MAP_VIEW_FLY_OVERVIEW_MS);
    expect(mapDroneDurationMs(drive, overview)).toBe(MAP_VIEW_FLY_OVERVIEW_MS);
    const mapView = { ...drive, zoom: 15.4, pitch: 0, bearing: 0 };
    expect(mapDroneDurationMs(drive, mapView)).toBe(MAP_VIEW_FLY_MS);
    expect(MAP_VIEW_FLY_OVERVIEW_MS).toBeLessThanOrEqual(MAP_VIEW_FLY_MAX_MS);
    expect(MAP_VIEW_FLY_MS).toBeLessThan(MAP_VIEW_FLY_OVERVIEW_MS);
  });
});

describe("droneLookAtScreen", () => {
  it("slides the puck from its current pixel to the destination yard-line", () => {
    const lookAt = {
      lng: -90,
      lat: 38,
      fromScreen: { x: 40, y: 60 },
      toAnchor: { x: 200, y: 500 },
    };
    expect(droneLookAtScreen(lookAt, 0)).toEqual(lookAt.fromScreen);
    expect(droneLookAtScreen(lookAt, 1)).toEqual(lookAt.toAnchor);
    const mid = droneLookAtScreen(lookAt, 0.5);
    expect(mid.x).toBeGreaterThan(40);
    expect(mid.x).toBeLessThan(200);
  });
});
