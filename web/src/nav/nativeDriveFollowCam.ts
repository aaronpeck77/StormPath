/**
 * Native Drive follow-cam — keep in sync with DriveFollowCam.swift.
 * iOS owns center / bearing / pitch / zoom. JS only applies the sample.
 */

import { smoothDriveBearingDeg } from "../ui/mapDriveCamera";
import {
  clampDriveFollowZoom,
  DRIVE_FOLLOW_ZOOM_DEFAULT,
} from "../ui/driveFollowZoomGuard";
import { DRIVE_FOLLOW_PITCH_DEG } from "../ui/mapDriveCamera";

export type NativeDriveFollowCamera = {
  lng: number;
  lat: number;
  bearing: number;
  pitch: number;
  zoom: number;
};

const TRAVEL_MIN_SPEED_MPS = 1.8;
const HIGHWAY_ZOOM = 15.1;
const SPEED_ZOOM_START_MPS = 11;
const SPEED_ZOOM_END_MPS = 28;
const BEARING_ALPHA = 0.35;

export function nativeDriveFollowZoomForSpeed(speedMps: number | null | undefined): number {
  const s = speedMps != null && Number.isFinite(speedMps) ? Math.max(0, speedMps) : 0;
  if (s <= SPEED_ZOOM_START_MPS) return clampDriveFollowZoom(DRIVE_FOLLOW_ZOOM_DEFAULT);
  if (s >= SPEED_ZOOM_END_MPS) return clampDriveFollowZoom(HIGHWAY_ZOOM);
  const t = (s - SPEED_ZOOM_START_MPS) / (SPEED_ZOOM_END_MPS - SPEED_ZOOM_START_MPS);
  return clampDriveFollowZoom(DRIVE_FOLLOW_ZOOM_DEFAULT + (HIGHWAY_ZOOM - DRIVE_FOLLOW_ZOOM_DEFAULT) * t);
}

export function createNativeDriveFollowCam(): {
  next: (input: {
    lng: number;
    lat: number;
    headingDeg: number | null;
    speedMps: number | null;
  }) => NativeDriveFollowCamera;
  reset: () => void;
} {
  let lastBearing: number | null = null;

  return {
    reset() {
      lastBearing = null;
    },
    next(input) {
      const heading =
        input.headingDeg != null && Number.isFinite(input.headingDeg) && input.headingDeg >= 0
          ? input.headingDeg
          : null;
      const speed = input.speedMps;
      const moving = speed == null || !Number.isFinite(speed) || speed >= TRAVEL_MIN_SPEED_MPS;
      let raw: number;
      if (heading != null && (moving || lastBearing == null)) {
        raw = heading;
      } else if (lastBearing != null) {
        raw = lastBearing;
      } else {
        raw = heading ?? 0;
      }
      const bearing = smoothDriveBearingDeg(lastBearing, raw, BEARING_ALPHA);
      lastBearing = bearing;
      return {
        lng: input.lng,
        lat: input.lat,
        bearing,
        pitch: DRIVE_FOLLOW_PITCH_DEG,
        zoom: nativeDriveFollowZoomForSpeed(speed),
      };
    },
  };
}

export function parseNativeDriveFollowCamera(raw: {
  camLng?: number;
  camLat?: number;
  camBearing?: number;
  camPitch?: number;
  camZoom?: number;
  lng?: number;
  lat?: number;
}): NativeDriveFollowCamera | null {
  const lng = raw.camLng ?? raw.lng;
  const lat = raw.camLat ?? raw.lat;
  const bearing = raw.camBearing;
  if (
    lng == null ||
    lat == null ||
    bearing == null ||
    !Number.isFinite(lng) ||
    !Number.isFinite(lat) ||
    !Number.isFinite(bearing)
  ) {
    return null;
  }
  return {
    lng,
    lat,
    bearing: ((bearing % 360) + 360) % 360,
    pitch:
      raw.camPitch != null && Number.isFinite(raw.camPitch) ? raw.camPitch : DRIVE_FOLLOW_PITCH_DEG,
    zoom: clampDriveFollowZoom(raw.camZoom),
  };
}

/** True when DriveMap must apply native cam and must not write its own follow-cam. */
export function shouldUseNativeFollowCam(input: {
  camera: NativeDriveFollowCamera | null | undefined;
  navigationStarted: boolean;
  viewMode: string;
  userExploring: boolean;
}): boolean {
  return Boolean(
    input.camera &&
      input.navigationStarted &&
      input.viewMode === "drive" &&
      !input.userExploring
  );
}
