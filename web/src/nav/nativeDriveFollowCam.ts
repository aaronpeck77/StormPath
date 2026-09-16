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
import { haversineMeters } from "./routeGeometry";
import { NATIVE_DRIVE_FOLLOW_CAM_ENABLED } from "./nativeDriveMapShell";

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
    stepRemainingM?: number | null;
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
      const speedN = speed != null && Number.isFinite(speed) ? Math.max(0, speed) : 0;
      const moving = speed == null || !Number.isFinite(speed) || speed >= TRAVEL_MIN_SPEED_MPS;
      let raw: number;
      if (heading != null && (moving || lastBearing == null)) {
        raw = heading;
      } else if (lastBearing != null) {
        raw = lastBearing;
      } else {
        raw = heading ?? 0;
      }
      const stepRem = input.stepRemainingM;
      const nearTurn =
        stepRem != null &&
        Number.isFinite(stepRem) &&
        stepRem >= 0 &&
        stepRem <= Math.max(60, speedN * 3);
      const alpha = nearTurn ? 0.48 : BEARING_ALPHA;
      const bearing = smoothDriveBearingDeg(lastBearing, raw, alpha);
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

/** Parked GPS wobble is 5–10 m per fix; the puck damps it, a raw camera write does not. */
export const PARKED_CAM_HOLD_M = 12;
export const PARKED_CAM_HOLD_DEG = 25;

/**
 * True when a stationary sample is close enough to the last applied one to be wobble
 * rather than movement. Holding the camera is what keeps the map still at a light.
 */
export function shouldHoldParkedFollowCam(input: {
  stationary: boolean;
  held: { lng: number; lat: number; bearing: number } | null;
  next: { lng: number; lat: number; bearing: number };
}): boolean {
  if (!input.stationary || !input.held) return false;
  const moved = haversineMeters(
    [input.held.lng, input.held.lat],
    [input.next.lng, input.next.lat]
  );
  if (!Number.isFinite(moved) || moved >= PARKED_CAM_HOLD_M) return false;
  const turn = Math.abs((((input.next.bearing - input.held.bearing) % 360) + 540) % 360 - 180);
  return turn < PARKED_CAM_HOLD_DEG;
}

/** True when DriveMap must apply native cam and must not write its own follow-cam. */
export function shouldUseNativeFollowCam(input: {
  camera: NativeDriveFollowCamera | null | undefined;
  navigationStarted: boolean;
  viewMode: string;
  userExploring: boolean;
}): boolean {
  return Boolean(
    NATIVE_DRIVE_FOLLOW_CAM_ENABLED &&
      input.camera &&
      input.navigationStarted &&
      input.viewMode === "drive" &&
      !input.userExploring
  );
}

/**
 * Core hands ~1 sample/s. Re-applying that pose at 60 fps while pan (yard-line
 * offset) and hard setCenter (no offset) take turns is the two-image flicker on
 * the StormPath map. Native NavigationMapView never did that — one writer, one
 * sample. Skip the web write until the sample actually moved.
 */
/**
 * Turn anticipation on top of Core's bearing.
 *
 * Core reports course over ground — where the car points *now* — so on the web map
 * the turn arrives before the camera does. The route tangent ahead of the puck
 * (`computeDriveRouteBearing`, which already looks ~4.5 s down the corridor and
 * stretches past a near maneuver) is the anticipation; lean partway toward it.
 *
 * Guards: only while actually moving, and only when the two roughly agree. A large
 * disagreement means the route tangent is stale or we are off it, and Core wins.
 */
export const NATIVE_CAM_ANTICIPATE_MIN_SPEED_MPS = 2.2;
export const NATIVE_CAM_ANTICIPATE_MAX_DELTA_DEG = 75;
export const NATIVE_CAM_ANTICIPATE_WEIGHT = 0.45;

export function anticipateNativeCamBearingDeg(input: {
  coreBearingDeg: number;
  routeAheadBearingDeg: number | null | undefined;
  speedMps: number | null | undefined;
  weight?: number;
}): number {
  const core = input.coreBearingDeg;
  if (!Number.isFinite(core)) return core;
  const ahead = input.routeAheadBearingDeg;
  if (ahead == null || !Number.isFinite(ahead)) return core;
  const speed = input.speedMps;
  if (speed == null || !Number.isFinite(speed) || speed < NATIVE_CAM_ANTICIPATE_MIN_SPEED_MPS) {
    return core;
  }
  const delta = (((ahead - core) % 360) + 540) % 360 - 180;
  if (Math.abs(delta) > NATIVE_CAM_ANTICIPATE_MAX_DELTA_DEG) return core;
  const weight = input.weight ?? NATIVE_CAM_ANTICIPATE_WEIGHT;
  const next = core + delta * weight;
  return ((next % 360) + 360) % 360;
}

export const NATIVE_FOLLOW_CAM_WEB_MOVE_M = 0.8;
export const NATIVE_FOLLOW_CAM_WEB_BEARING_DEG = 0.45;
export const NATIVE_FOLLOW_CAM_WEB_ZOOM = 0.04;

export function nativeFollowCamNeedsWebWrite(input: {
  next: NativeDriveFollowCamera;
  lastApplied: { lng: number; lat: number; bearing: number; pitch?: number; zoom?: number } | null;
  resync: boolean;
}): boolean {
  if (input.resync || !input.lastApplied) return true;
  const a = input.lastApplied;
  const n = input.next;
  const moved = haversineMeters([a.lng, a.lat], [n.lng, n.lat]);
  if (Number.isFinite(moved) && moved >= NATIVE_FOLLOW_CAM_WEB_MOVE_M) return true;
  const turn = Math.abs((((n.bearing - a.bearing) % 360) + 540) % 360 - 180);
  if (turn >= NATIVE_FOLLOW_CAM_WEB_BEARING_DEG) return true;
  if (a.zoom != null && Math.abs(n.zoom - a.zoom) >= NATIVE_FOLLOW_CAM_WEB_ZOOM) return true;
  if (a.pitch != null && Math.abs(n.pitch - a.pitch) >= 0.5) return true;
  return false;
}
