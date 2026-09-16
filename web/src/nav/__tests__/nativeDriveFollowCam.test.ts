import { describe, expect, it } from "vitest";
import {
  createNativeDriveFollowCam,
  nativeDriveFollowZoomForSpeed,
  parseNativeDriveFollowCamera,
  PARKED_CAM_HOLD_M,
  shouldHoldParkedFollowCam,
  shouldUseNativeFollowCam,
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
