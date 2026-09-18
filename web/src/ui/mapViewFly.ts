import type { Map } from "mapbox-gl";
import type { MapViewMode } from "./driveMapTypes";
import type { LngLat } from "../nav/types";
import { isMapReadyForFollowCam, readMapLngLat, safePanToCenter } from "./mapCameraSafe";
import { centerForPuckScreenAnchor } from "./driveFollowCamAnchor";

/**
 * Dr / Mp / Rt is one drone shot. Never a cut.
 *
 * Mapbox flyTo zooms out then in (two images). lockDescendStartToPuck jumped
 * the center onto the puck at overview zoom (another cut). This file is the
 * only writer while the shot is in the air: lerp every channel from the live
 * camera to the target pose. Follow-cam / fit / snap yield until it lands.
 */
export const MAP_VIEW_FLY_MS = 1200;
export const MAP_VIEW_FLY_MAX_MS = 2000;

export type MapDronePose = {
  lng: number;
  lat: number;
  zoom: number;
  pitch: number;
  bearing: number;
  padding: { top: number; bottom: number; left: number; right: number };
  offset: [number, number];
};

export type MapDroneLookAt = {
  lng: number;
  lat: number;
  fromScreen: { x: number; y: number };
  toAnchor: { x: number; y: number };
};

export const ZERO_DRONE_PADDING = { top: 0, bottom: 0, left: 0, right: 0 };

export function shouldAnimateMapViewFly(input: {
  prevViewMode: MapViewMode | null;
  nextViewMode: MapViewMode;
  destPlaceHold?: boolean;
  offRouteCompare?: boolean;
  routeCompare?: boolean;
}): boolean {
  if (input.prevViewMode == null) return false;
  if (input.prevViewMode === input.nextViewMode) return false;
  if (input.destPlaceHold) return false;
  if (input.offRouteCompare || input.routeCompare) return false;
  /* A pinch/pan on Mp or Rt must not cancel the drone. The shot starts from the
   * live camera (wherever they were looking) and lands on the tapped view. */
  return true;
}

/** Drive and Map keep the puck in the shot; Route pans out to the trip. */
export function shouldTrackPuckThroughDrone(nextViewMode: MapViewMode): boolean {
  return nextViewMode === "drive" || nextViewMode === "topdown";
}

export function shortestBearingDeltaDeg(from: number, to: number): number {
  let d = to - from;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

/** Smoothstep — accelerate then ease in so the shot does not hitch at the ends. */
export function mapDroneEase(u: number): number {
  const x = Math.max(0, Math.min(1, u));
  return x * x * (3 - 2 * x);
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function segmentEase(u: number, start: number, end: number): number {
  if (end <= start) return u >= end ? 1 : 0;
  const x = Math.max(0, Math.min(1, u));
  if (x <= start) return 0;
  if (x >= end) return 1;
  return mapDroneEase((x - start) / (end - start));
}

/**
 * Zoom-in: pan/zoom first, tip into Drive later (still one shot — pitch never jumps).
 * Zoom-out: flatten first, then pull up. Same-zoom (Dr↔Mp): everything together.
 */
export function droneTiltT(from: MapDronePose, to: MapDronePose, u: number): number {
  const zoomingIn = to.zoom - from.zoom >= 1.2;
  const zoomingOut = from.zoom - to.zoom >= 1.2;
  if (zoomingIn) return segmentEase(u, 0.28, 1);
  if (zoomingOut) return segmentEase(u, 0, 0.55);
  return mapDroneEase(u);
}

export function mapDroneDurationMs(from: MapDronePose, to: MapDronePose): number {
  const z = Math.abs(to.zoom - from.zoom);
  const p = Math.abs(to.pitch - from.pitch);
  const b = Math.abs(shortestBearingDeltaDeg(from.bearing, to.bearing));
  const ms = MAP_VIEW_FLY_MS + z * 90 + p * 5 + b * 2;
  return Math.max(MAP_VIEW_FLY_MS, Math.min(MAP_VIEW_FLY_MAX_MS, Math.round(ms)));
}

export function posesNearlyEqual(a: MapDronePose, b: MapDronePose, eps = 1e-4): boolean {
  if (Math.abs(a.lng - b.lng) > eps) return false;
  if (Math.abs(a.lat - b.lat) > eps) return false;
  if (Math.abs(a.zoom - b.zoom) > 1e-3) return false;
  if (Math.abs(a.pitch - b.pitch) > 1e-3) return false;
  if (Math.abs(shortestBearingDeltaDeg(a.bearing, b.bearing)) > 1e-2) return false;
  return true;
}

/**
 * Continuous pose. u=0 is exactly `from` (no teleport). u=1 is exactly `to`.
 * Zoom never reverses. Pitch/offset may lag on a zoom-in but they start at `from`.
 */
export function lerpMapDronePose(from: MapDronePose, to: MapDronePose, u: number): MapDronePose {
  const x = Math.max(0, Math.min(1, u));
  const mainT = mapDroneEase(x);
  const tiltT = droneTiltT(from, to, x);
  const bearing = from.bearing + shortestBearingDeltaDeg(from.bearing, to.bearing) * mainT;
  return {
    lng: mix(from.lng, to.lng, mainT),
    lat: mix(from.lat, to.lat, mainT),
    zoom: mix(from.zoom, to.zoom, mainT),
    pitch: mix(from.pitch, to.pitch, tiltT),
    bearing: ((bearing % 360) + 360) % 360,
    padding: {
      top: mix(from.padding.top, to.padding.top, mainT),
      bottom: mix(from.padding.bottom, to.padding.bottom, mainT),
      left: mix(from.padding.left, to.padding.left, mainT),
      right: mix(from.padding.right, to.padding.right, mainT),
    },
    offset: [
      mix(from.offset[0], to.offset[0], tiltT),
      mix(from.offset[1], to.offset[1], tiltT),
    ],
  };
}

export function droneLookAtScreen(lookAt: MapDroneLookAt, u: number): { x: number; y: number } {
  const t = mapDroneEase(u);
  return {
    x: mix(lookAt.fromScreen.x, lookAt.toAnchor.x, t),
    y: mix(lookAt.fromScreen.y, lookAt.toAnchor.y, t),
  };
}

export function readPadding(raw: unknown): MapDronePose["padding"] {
  if (!raw || typeof raw !== "object") return { ...ZERO_DRONE_PADDING };
  const o = raw as { top?: unknown; bottom?: unknown; left?: unknown; right?: unknown };
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return { top: n(o.top), bottom: n(o.bottom), left: n(o.left), right: n(o.right) };
}

export function poseFromLngLat(
  ll: LngLat,
  rest: Omit<MapDronePose, "lng" | "lat">
): MapDronePose {
  return { lng: ll[0], lat: ll[1], ...rest };
}

export function readMapDronePose(map: Map, offset: [number, number]): MapDronePose | null {
  if (!isMapReadyForFollowCam(map)) return null;
  try {
    const ll = readMapLngLat(map.getCenter());
    if (!ll) return null;
    const zoom = map.getZoom();
    const pitch = map.getPitch();
    const bearing = map.getBearing();
    if (![zoom, pitch, bearing].every((n) => typeof n === "number" && Number.isFinite(n))) {
      return null;
    }
    return {
      lng: ll[0],
      lat: ll[1],
      zoom,
      pitch,
      bearing: ((bearing % 360) + 360) % 360,
      padding: readPadding(map.getPadding?.() ?? null),
      offset: [offset[0], offset[1]],
    };
  } catch {
    return null;
  }
}

/** One frame of the drone — duration 0, no map.stop(), same path as follow-cam. */
export function applyMapDronePose(map: Map, pose: MapDronePose): boolean {
  return safePanToCenter(map, {
    center: [pose.lng, pose.lat],
    zoom: pose.zoom,
    pitch: pose.pitch,
    bearing: pose.bearing,
    padding: pose.padding,
    offset: pose.offset,
    duration: 0,
    essential: true,
  });
}

/**
 * Write one interpolated frame. When `lookAt` is set (Dr / Mp), the puck's
 * screen position slides from where it is now to the destination yard-line —
 * the camera pans to keep it, instead of leaping to it.
 */
export function applyContinuousDroneFrame(
  map: Map,
  from: MapDronePose,
  to: MapDronePose,
  u: number,
  lookAt: MapDroneLookAt | null
): MapDronePose {
  const pose = lerpMapDronePose(from, to, u);
  applyMapDronePose(map, pose);
  if (!lookAt) return pose;
  const anchor = droneLookAtScreen(lookAt, u);
  const next = centerForPuckScreenAnchor({
    project: (ll) => map.project(ll),
    unproject: (pt) => map.unproject(pt),
    center: [pose.lng, pose.lat],
    puck: [lookAt.lng, lookAt.lat],
    anchor,
    minShiftPx: 0.25,
  });
  if (!next) return pose;
  const corrected: MapDronePose = { ...pose, lng: next[0], lat: next[1] };
  applyMapDronePose(map, corrected);
  return corrected;
}
