import type { PaddingOptions } from "mapbox-gl";
import { headingDeltaDegrees } from "../nav/forwardRoutePick";
import { haversineMeters, initialBearingDegrees } from "../nav/routeGeometry";
import {
  isLandscapeHandLeft,
  isLandscapeViewport,
  isNarrowPhoneViewport,
  routeProgressRailRightClearancePx,
  stormBarTopExtraPx,
} from "./mapFitLogic";

/** Drive follow-cam puck placement — football-field metaphor (% up from bottom toward midfield). */
const DRIVE_PUCK_YARD_LINE = 30;

/** Max camera bearing change per frame (deg) — kills wild spins when route tangent jumps near forks / turns. */
const DRIVE_CAMERA_BEARING_MAX_STEP_DEG = 9;

/**
 * If route look-ahead disagrees with travel direction by more than this, keep the camera
 * behind the vehicle (travel) so the map never flips sideways / upside-down at ramps.
 */
const ROUTE_VS_TRAVEL_AGREE_DEG = 55;

/** Prefer GPS course once moving faster than a crawl (~8 mph). */
const TRAVEL_HEADING_MIN_SPEED_MPS = 3.5;

export function drivePuckFollowOffsetY(
  viewportHeight: number,
  baseOffsetAt25YardLine: number,
  opts?: { min?: number; max?: number }
): number {
  const yardDeltaPx = Math.round(((DRIVE_PUCK_YARD_LINE - 25) / 100) * viewportHeight);
  const y = Math.round(baseOffsetAt25YardLine - yardDeltaPx);
  if (opts?.min != null && opts?.max != null) return Math.min(opts.max, Math.max(opts.min, y));
  if (opts?.min != null) return Math.max(opts.min, y);
  if (opts?.max != null) return Math.min(opts.max, y);
  return y;
}

export function driveCameraEaseOptions(
  stormBarVisible: boolean,
  stormBarExpanded: boolean,
  progressRailVisible: boolean
): { padding: PaddingOptions; offset: [number, number] } {
  const stormTop = stormBarTopExtraPx(stormBarVisible, stormBarExpanded);
  const rightNeed = progressRailVisible ? routeProgressRailRightClearancePx() : 18;
  if (isLandscapeViewport()) {
    const handLeft = isLandscapeHandLeft();
    const vw = typeof window !== "undefined" ? window.innerWidth : 900;
    const vh = typeof window !== "undefined" ? window.innerHeight : 400;
    const rightChrome = Math.max(200, Math.round(vw * 0.5) + 8);
    const railPad = Math.max(72, rightNeed + 14);
    const topPad = Math.max(52, 44 + Math.round(stormTop * 0.45));
    const bottomPad = Math.max(36, 48);
    const yOff = drivePuckFollowOffsetY(vh, Math.round(vh * 0.22), { min: 72, max: 140 });
    if (handLeft) {
      return {
        padding: {
          top: topPad,
          bottom: bottomPad,
          left: rightChrome,
          right: railPad,
        },
        offset: [progressRailVisible ? -10 : -2, yOff],
      };
    }
    return {
      padding: {
        top: topPad,
        bottom: bottomPad,
        left: railPad,
        right: rightChrome,
      },
      offset: [progressRailVisible ? 10 : 2, yOff],
    };
  }
  if (isNarrowPhoneViewport()) {
    const sidePad = Math.max(12, Math.max(104, rightNeed));
    const vh = typeof window !== "undefined" ? window.innerHeight : 800;
    return {
      padding: {
        top: 172 + stormTop,
        bottom: 156,
        left: sidePad,
        right: sidePad,
      },
      offset: [0, drivePuckFollowOffsetY(vh, 224)],
    };
  }
  const sidePadWide = Math.max(16, Math.max(96, rightNeed));
  const vh = typeof window !== "undefined" ? window.innerHeight : 900;
  return {
    padding: {
      top: 268 + stormTop,
      bottom: 176,
      left: sidePadWide,
      right: sidePadWide,
    },
    offset: [0, drivePuckFollowOffsetY(vh, 320)],
  };
}

export function smoothDriveBearingDeg(prev: number | null, raw: number, alpha: number): number {
  if (prev == null || !Number.isFinite(prev)) return raw;
  if (!Number.isFinite(raw)) return prev;
  let d = raw - prev;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  if (d > 179) d = 179;
  if (d < -179) d = -179;
  let step = d * alpha;
  if (step > DRIVE_CAMERA_BEARING_MAX_STEP_DEG) step = DRIVE_CAMERA_BEARING_MAX_STEP_DEG;
  if (step < -DRIVE_CAMERA_BEARING_MAX_STEP_DEG) step = -DRIVE_CAMERA_BEARING_MAX_STEP_DEG;
  const next = prev + step;
  return ((next % 360) + 360) % 360;
}

type DriveFix = { lng: number; lat: number };

/** Travel direction from GPS course and/or recent motion — keeps the camera behind the puck. */
export function resolveTravelBearingDeg(input: {
  headingDeg: number | null;
  prevFix: DriveFix | null;
  curFix: DriveFix | null;
  speedMps?: number | null;
  minMotionBearingM?: number;
}): number | null {
  const minMotionM = input.minMotionBearingM ?? 8;
  const speed = input.speedMps;

  if (
    input.headingDeg != null &&
    Number.isFinite(input.headingDeg) &&
    speed != null &&
    Number.isFinite(speed) &&
    speed >= TRAVEL_HEADING_MIN_SPEED_MPS
  ) {
    return input.headingDeg;
  }

  if (input.prevFix && input.curFix) {
    const from: [number, number] = [input.prevFix.lng, input.prevFix.lat];
    const to: [number, number] = [input.curFix.lng, input.curFix.lat];
    if (haversineMeters(from, to) >= minMotionM) {
      return initialBearingDegrees(from, to);
    }
  }

  if (
    input.headingDeg != null &&
    Number.isFinite(input.headingDeg) &&
    speed != null &&
    Number.isFinite(speed) &&
    speed >= 1.5
  ) {
    return input.headingDeg;
  }

  return null;
}

/**
 * Drive follow-cam bearing — camera stays behind the puck (travel up-screen).
 * Route look-ahead is used only when it agrees with travel; wild ramp/parking
 * tangents cannot flip the map sideways or upside-down.
 */
export function resolveDriveFollowCameraBearingDeg(input: {
  offRouteForward: boolean;
  routeBearingDeg: number | null;
  headingDeg: number | null;
  prevFix: DriveFix | null;
  curFix: DriveFix | null;
  mapBearing: number;
  minMotionBearingM?: number;
  speedMps?: number | null;
}): number {
  const travel = resolveTravelBearingDeg(input);

  if (input.offRouteForward) {
    if (travel != null) return travel;
    if (input.headingDeg != null && Number.isFinite(input.headingDeg)) {
      return input.headingDeg;
    }
    return input.mapBearing;
  }

  const route =
    input.routeBearingDeg != null && Number.isFinite(input.routeBearingDeg)
      ? input.routeBearingDeg
      : null;

  if (travel != null && route != null) {
    if (headingDeltaDegrees(travel, route) <= ROUTE_VS_TRAVEL_AGREE_DEG) {
      return route;
    }
    return travel;
  }
  if (travel != null) return travel;
  if (route != null) return route;
  if (input.headingDeg != null && Number.isFinite(input.headingDeg)) {
    return input.headingDeg;
  }
  return input.mapBearing;
}
