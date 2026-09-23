import { describe, expect, it } from "vitest";
import {
  anticipateNativeCamBearingDeg,
  createNativeDriveFollowCam,
  nativeDriveFollowZoomForSpeed,
  parseNativeDriveFollowCamera,
  PARKED_CAM_HOLD_M,
  shouldHoldParkedFollowCam,
  shouldUseNativeFollowCam,
  nativeFollowCamNeedsWebWrite,
} from "../nativeDriveFollowCam";
import { DRIVE_FOLLOW_PITCH_DEG } from "../../ui/mapDriveCamera";
import { DRIVE_FOLLOW_ZOOM_DEFAULT, DRIVE_FOLLOW_ZOOM_MIN } from "../../ui/driveFollowZoomGuard";

describe("nativeDriveFollowZoomForSpeed", () => {
  it("stays street-level when crawling", () => {
    expect(nativeDriveFollowZoomForSpeed(8)).toBe(DRIVE_FOLLOW_ZOOM_DEFAULT);
  });

  it("pulls back on the highway but never to Canada", () => {
    const z = nativeDriveFollowZoomForSpeed(35);
    expect(z).toBeLessThan(DRIVE_FOLLOW_ZOOM_DEFAULT);
    expect(z).toBeGreaterThanOrEqual(DRIVE_FOLLOW_ZOOM_MIN);
  });
});

describe("createNativeDriveFollowCam", () => {
  it("uses course when moving and holds bearing when parked", () => {
    const cam = createNativeDriveFollowCam();
    const a = cam.next({ lng: -90.2, lat: 38.63, headingDeg: 90, speedMps: 12 });
    expect(a.pitch).toBe(DRIVE_FOLLOW_PITCH_DEG);
    expect(a.bearing).toBeGreaterThan(0);
    const parked = cam.next({ lng: -90.2, lat: 38.63, headingDeg: 270, speedMps: 0.2 });
    const delta = Math.abs(parked.bearing - a.bearing);
    expect(Math.min(delta, 360 - delta)).toBeLessThan(20);
  });

  it("rejects continent zoom from a bad sample", () => {
    const parsed = parseNativeDriveFollowCamera({
      lng: -90.2,
      lat: 38.63,
      camBearing: 12,
      camZoom: 6.2,
    });
    expect(parsed?.zoom).toBe(DRIVE_FOLLOW_ZOOM_DEFAULT);
  });
});

describe("anticipateNativeCamBearingDeg", () => {
  it("leans a little toward the route ahead so the turn is visible before it arrives", () => {
    const out = anticipateNativeCamBearingDeg({
      coreBearingDeg: 0,
      routeAheadBearingDeg: 40,
      speedMps: 12,
    });
    expect(out).toBeGreaterThan(0);
    expect(out).toBeLessThan(16);
  });

  it("stays on Core until the turn is actually close", () => {
    expect(
      anticipateNativeCamBearingDeg({
        coreBearingDeg: 0,
        routeAheadBearingDeg: 40,
        speedMps: 14,
        metersToManeuver: 120,
      })
    ).toBe(0);
    const near = anticipateNativeCamBearingDeg({
      coreBearingDeg: 0,
      routeAheadBearingDeg: 40,
      speedMps: 14,
      metersToManeuver: 25,
    });
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(12);
  });

  it("does not yank then drop when the chord is a hard corner", () => {
    /* Old cutoff: 70° leaned ~30°, 76° snapped to Core — the swing-back. */
    const mid = anticipateNativeCamBearingDeg({
      coreBearingDeg: 0,
      routeAheadBearingDeg: 70,
      speedMps: 14,
    });
    expect(mid).toBe(0);
    const near = anticipateNativeCamBearingDeg({
      coreBearingDeg: 0,
      routeAheadBearingDeg: 40,
      speedMps: 14,
    });
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(12);
  });

  it("does not swing the camera while parked or crawling", () => {
    expect(
      anticipateNativeCamBearingDeg({
        coreBearingDeg: 0,
        routeAheadBearingDeg: 40,
        speedMps: 0.3,
      })
    ).toBe(0);
  });

  it("keeps Core's bearing when the route tangent disagrees wildly", () => {
    expect(
      anticipateNativeCamBearingDeg({
        coreBearingDeg: 10,
        routeAheadBearingDeg: 190,
        speedMps: 20,
      })
    ).toBe(10);
  });

  it("anticipates across the 360 seam without spinning the map", () => {
    const out = anticipateNativeCamBearingDeg({
      coreBearingDeg: 350,
      routeAheadBearingDeg: 20,
      speedMps: 20,
    });
    /* 30 deg of turn, leaned partway → just past north (wrapped), not back through 180. */
    const shortest = (((out - 350) % 360) + 540) % 360 - 180;
    expect(shortest).toBeGreaterThan(0);
    expect(shortest).toBeLessThan(30);
    expect(out).toBeGreaterThanOrEqual(0);
    expect(out).toBeLessThan(360);
  });

  it("passes Core straight through with no route tangent", () => {
    expect(
      anticipateNativeCamBearingDeg({
        coreBearingDeg: 128,
        routeAheadBearingDeg: null,
        speedMps: 20,
      })
    ).toBe(128);
  });
});

describe("shouldHoldParkedFollowCam", () => {
  const held = { lng: -90.2, lat: 38.63, bearing: 90 };
  /** ~1e-4 deg of longitude at 38°N is roughly 8.7 m. */
  const wobble = { lng: -90.2001, lat: 38.63, bearing: 96 };

  it("holds the camera through GPS wobble while parked", () => {
    expect(shouldHoldParkedFollowCam({ stationary: true, held, next: wobble })).toBe(true);
  });

  it("never holds while moving, however small the step", () => {
    expect(shouldHoldParkedFollowCam({ stationary: false, held, next: wobble })).toBe(false);
  });

  it("releases once the sample moves further than wobble", () => {
    const rolled = { lng: -90.2, lat: 38.6306, bearing: 90 }; /* ~67 m north */
    expect(shouldHoldParkedFollowCam({ stationary: true, held, next: rolled })).toBe(false);
    expect(PARKED_CAM_HOLD_M).toBeLessThan(67);
  });

  it("releases when the car turns in place", () => {
    const spun = { lng: -90.2, lat: 38.63, bearing: 190 };
    expect(shouldHoldParkedFollowCam({ stationary: true, held, next: spun })).toBe(false);
  });

  it("applies the first sample of a trip", () => {
    expect(shouldHoldParkedFollowCam({ stationary: true, held: null, next: wobble })).toBe(false);
  });
});

describe("shouldUseNativeFollowCam", () => {
  const camera = { lng: -90, lat: 38, bearing: 10, pitch: 64, zoom: 16.35 };

  it("owns Drive follow-cam when Core is guiding", () => {
    expect(
      shouldUseNativeFollowCam({
        camera,
        navigationStarted: true,
        viewMode: "drive",
        userExploring: false,
      })
    ).toBe(true);
  });

  it("releases for Mp, explore, or missing sample", () => {
    expect(
      shouldUseNativeFollowCam({
        camera,
        navigationStarted: true,
        viewMode: "topdown",
        userExploring: false,
      })
    ).toBe(false);
    expect(
      shouldUseNativeFollowCam({
        camera,
        navigationStarted: true,
        viewMode: "drive",
        userExploring: true,
      })
    ).toBe(false);
    expect(
      shouldUseNativeFollowCam({
        camera: null,
        navigationStarted: true,
        viewMode: "drive",
        userExploring: false,
      })
    ).toBe(false);
  });
});

describe("nativeFollowCamNeedsWebWrite", () => {
  const sample = { lng: -90.2, lat: 38.63, bearing: 90, pitch: 64, zoom: 16.35 };

  it("writes the first sample and a resync", () => {
    expect(nativeFollowCamNeedsWebWrite({ next: sample, lastApplied: null, resync: false })).toBe(
      true
    );
    expect(
      nativeFollowCamNeedsWebWrite({ next: sample, lastApplied: sample, resync: true })
    ).toBe(true);
  });

  it("does not re-apply the same Core pose at 60 fps (47 samples vs 2519 writes)", () => {
    let last = sample;
    let writes = 0;
    for (let i = 0; i < 2519; i++) {
      const next =
        i % 54 === 0
          ? { ...sample, lng: sample.lng + i * 0.00002, bearing: sample.bearing + i * 0.01 }
          : last;
      if (nativeFollowCamNeedsWebWrite({ next, lastApplied: last, resync: false })) {
        writes += 1;
        last = next;
      }
    }
    expect(writes).toBeLessThan(80);
    expect(writes).toBeGreaterThan(20);
  });

  it("writes when the car actually moved", () => {
    const moved = { ...sample, lat: 38.631 };
    expect(nativeFollowCamNeedsWebWrite({ next: moved, lastApplied: sample, resync: false })).toBe(
      true
    );
  });
});
