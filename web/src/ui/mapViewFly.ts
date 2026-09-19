import type { Map } from "mapbox-gl";
import type { MapViewMode } from "./driveMapTypes";
import type { LngLat } from "../nav/types";
import { isMapReadyForFollowCam, readMapLngLat } from "./mapCameraSafe";

/**
 * Dr / Mp / Rt is one drone shot. Never a cut.
 *
 * Mapbox flyTo zooms out then in (two images). lockDescendStartToPuck jumped
 * the center onto the puck at overview zoom (another cut). This file is the
 * only writer while the shot is in the air: lerp every channel from the live
 * camera to the target pose. Follow-cam / fit / snap yield until it lands.
 */
/** Dr↔Mp is a rotate/flatten over the car. Rt hops need more time to climb or dive. */
export const MAP_VIEW_FLY_MS = 1400;
export const MAP_VIEW_FLY_OVERVIEW_MS = 2200;
export const MAP_VIEW_FLY_MAX_MS = 2200;

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

export type MapViewFlySkip = "first" | "same" | "hold" | "compare";

export function mapViewFlySkipReason(input: {
  prevViewMode: MapViewMode | null;
  nextViewMode: MapViewMode;
  destPlaceHold?: boolean;
  offRouteCompare?: boolean;
  routeCompare?: boolean;
}): MapViewFlySkip | null {
  if (input.prevViewMode == null) return "first";
  if (input.prevViewMode === input.nextViewMode) return "same";
  if (input.destPlaceHold) return "hold";
  if (input.offRouteCompare || input.routeCompare) return "compare";
  /* A pinch/pan on Mp or Rt must not cancel the drone. The shot starts from the
   * live camera (wherever they were looking) and lands on the tapped view. */
  return null;
}

export function shouldAnimateMapViewFly(input: {
  prevViewMode: MapViewMode | null;
  nextViewMode: MapViewMode;
  destPlaceHold?: boolean;
  offRouteCompare?: boolean;
  routeCompare?: boolean;
}): boolean {
  return mapViewFlySkipReason(input) == null;
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

/** Linear — smoothstep sat still for the first third and felt hung. */
export function mapDroneEase(u: number): number {
  return Math.max(0, Math.min(1, u));
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function droneTiltT(_from: MapDronePose, _to: MapDronePose, u: number): number {
  return mapDroneEase(u);
}

export function mapDroneDurationMs(from?: MapDronePose, to?: MapDronePose): number {
  if (!from || !to) return MAP_VIEW_FLY_MS;
  if (Math.abs(to.zoom - from.zoom) >= 3) return MAP_VIEW_FLY_OVERVIEW_MS;
  return MAP_VIEW_FLY_MS;
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
 * Reach the puck before the dive finishes so Rt→Dr does not lose the car.
 * Still u=0 on the live camera — never a first-frame leap.
 */
export const MAP_VIEW_DRONE_PUCK_PULL = 0.42;
/** Stay over the current view while climbing, then truck to the trip. Dr→Mp is this without the truck. */
export const MAP_VIEW_DRONE_CLIMB_HOLD = 0.45;

function isFiniteLngLat(p: { lng: number; lat: number } | null | undefined): p is {
  lng: number;
  lat: number;
} {
  return Boolean(p && Number.isFinite(p.lng) && Number.isFinite(p.lat));
}

/**
 * Continuous pose. u=0 is exactly `from` (no teleport). u=1 is exactly `to`.
 * Dr↔Mp: rotate/flatten over the car. Rt out: hold the subject, then truck.
 * Rt in: swing past the puck, then land on the Drive/Map pose.
 */
export function lerpMapDronePose(
  from: MapDronePose,
  to: MapDronePose,
  u: number,
  puck?: { lng: number; lat: number } | null
): MapDronePose {
  const t = mapDroneEase(u);
  const bearing = from.bearing + shortestBearingDeltaDeg(from.bearing, to.bearing) * t;
  const zoomingOut = from.zoom - to.zoom >= 3;
  const zoomingIn = to.zoom - from.zoom >= 3;
  let lng = mix(from.lng, to.lng, t);
  let lat = mix(from.lat, to.lat, t);
  if (zoomingOut) {
    const holdLng = isFiniteLngLat(puck) ? mix(from.lng, puck.lng, Math.min(1, t / 0.25)) : from.lng;
    const holdLat = isFiniteLngLat(puck) ? mix(from.lat, puck.lat, Math.min(1, t / 0.25)) : from.lat;
    const panT = mapDroneEase(
      Math.max(0, (u - MAP_VIEW_DRONE_CLIMB_HOLD) / (1 - MAP_VIEW_DRONE_CLIMB_HOLD))
    );
    lng = mix(holdLng, to.lng, panT);
    lat = mix(holdLat, to.lat, panT);
  } else if (zoomingIn && isFiniteLngLat(puck)) {
    const pull = mapDroneEase(Math.min(1, u / MAP_VIEW_DRONE_PUCK_PULL));
    lng = mix(mix(from.lng, puck.lng, pull), to.lng, t);
    lat = mix(mix(from.lat, puck.lat, pull), to.lat, t);
  }
  return {
    lng,
    lat,
    zoom: mix(from.zoom, to.zoom, t),
    pitch: mix(from.pitch, to.pitch, t),
    bearing: ((bearing % 360) + 360) % 360,
    padding: {
      top: mix(from.padding.top, to.padding.top, t),
      bottom: mix(from.padding.bottom, to.padding.bottom, t),
      left: mix(from.padding.left, to.padding.left, t),
      right: mix(from.padding.right, to.padding.right, t),
    },
    offset: [mix(from.offset[0], to.offset[0], t), mix(from.offset[1], to.offset[1], t)],
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

/**
 * Instant transform write. Must not use easeTo or isStyleLoaded(): mid-zoom
 * tile loads make style "unloaded", easeTo no-ops, and the shot hangs.
 * Must not map.stop() each frame — that is the hitch.
 */
export function writeDronePose(map: Map, pose: MapDronePose): boolean {
  if (!isMapReadyForFollowCam(map)) return false;
  try {
    map.jumpTo({
      center: [pose.lng, pose.lat],
      zoom: pose.zoom,
      pitch: pose.pitch,
      bearing: pose.bearing,
      padding: pose.padding,
    });
    return true;
  } catch {
    try {
      map.setCenter([pose.lng, pose.lat]);
      map.setZoom(pose.zoom);
      map.setPitch(pose.pitch);
      map.setBearing(pose.bearing);
      return true;
    } catch {
      return false;
    }
  }
}

export function applyMapDronePose(map: Map, pose: MapDronePose): boolean {
  return writeDronePose(map, pose);
}

/** One interpolated frame, one write. */
export function applyContinuousDroneFrame(
  map: Map,
  from: MapDronePose,
  to: MapDronePose,
  u: number,
  puck?: { lng: number; lat: number } | null
): { pose: MapDronePose; ok: boolean } {
  const pose = lerpMapDronePose(from, to, u, puck);
  return { pose, ok: writeDronePose(map, pose) };
}
