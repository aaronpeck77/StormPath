import type { Map } from "mapbox-gl";
import type { MapViewMode } from "./driveMapTypes";
import type { LngLat } from "../nav/types";
import { isMapReadyForFollowCam, readMapLngLat, safePanToCenter } from "./mapCameraSafe";

/**
 * Continuous "drone" move between Dr / Mp / Rt.
 * Mapbox flyTo zooms out then in (two shots). We lerp pose every frame instead.
 */
export const MAP_VIEW_FLY_MS = 1100;
/** Rt → Dr: slower so the camera can sit on the puck, then descend, then pitch behind. */
export const MAP_VIEW_DESCEND_MS = 1700;

export type MapDronePose = {
  lng: number;
  lat: number;
  zoom: number;
  pitch: number;
  bearing: number;
  padding: { top: number; bottom: number; left: number; right: number };
  offset: [number, number];
};

export const ZERO_DRONE_PADDING = { top: 0, bottom: 0, left: 0, right: 0 };

export function shouldAnimateMapViewFly(input: {
  prevViewMode: MapViewMode | null;
  nextViewMode: MapViewMode;
  userExploring?: boolean;
  destPlaceHold?: boolean;
  offRouteCompare?: boolean;
  routeCompare?: boolean;
}): boolean {
  if (input.prevViewMode == null) return false;
  if (input.prevViewMode === input.nextViewMode) return false;
  if (input.destPlaceHold) return false;
  if (input.offRouteCompare || input.routeCompare) return false;
  if (input.userExploring) return false;
  return true;
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

export function lerpMapDronePose(from: MapDronePose, to: MapDronePose, u: number): MapDronePose {
  const t = mapDroneEase(u);
  const bearing = from.bearing + shortestBearingDeltaDeg(from.bearing, to.bearing) * t;
  return {
    lng: mix(from.lng, to.lng, t),
    lat: mix(from.lat, to.lat, t),
    zoom: mix(from.zoom, to.zoom, t),
    pitch: mix(from.pitch, to.pitch, t),
    bearing: ((bearing % 360) + 360) % 360,
    padding: {
      top: mix(from.padding.top, to.padding.top, t),
      bottom: mix(from.padding.bottom, to.padding.bottom, t),
      left: mix(from.padding.left, to.padding.left, t),
      right: mix(from.padding.right, to.padding.right, t),
    },
    offset: [
      mix(from.offset[0], to.offset[0], t),
      mix(from.offset[1], to.offset[1], t),
    ],
  };
}

function segmentEase(u: number, start: number, end: number): number {
  if (end <= start) return u >= end ? 1 : 0;
  return mapDroneEase((u - start) / (end - start));
}

/**
 * Wide overview → Drive. Pan to the puck while still zoomed out, zoom down onto
 * it, then pitch/rotate behind the vehicle. Lerping center and zoom together is
 * what made Rt→Dr look like the map rushing past.
 */
export function shouldDescendOntoDrive(from: MapDronePose, to: MapDronePose): boolean {
  return to.zoom - from.zoom >= 2.4 && to.pitch - from.pitch >= 20;
}

export function lerpDescendOntoDrive(from: MapDronePose, to: MapDronePose, u: number): MapDronePose {
  const x = Math.max(0, Math.min(1, u));
  const centerT = segmentEase(x, 0, 0.34);
  const zoomT = segmentEase(x, 0.14, 0.84);
  const pitchT = segmentEase(x, 0.46, 1);
  const bearingT = segmentEase(x, 0.5, 1);
  const padT = zoomT;
  const bearing = from.bearing + shortestBearingDeltaDeg(from.bearing, to.bearing) * bearingT;
  return {
    lng: mix(from.lng, to.lng, centerT),
    lat: mix(from.lat, to.lat, centerT),
    zoom: mix(from.zoom, to.zoom, zoomT),
    pitch: mix(from.pitch, to.pitch, pitchT),
    bearing: ((bearing % 360) + 360) % 360,
    padding: {
      top: mix(from.padding.top, to.padding.top, padT),
      bottom: mix(from.padding.bottom, to.padding.bottom, padT),
      left: mix(from.padding.left, to.padding.left, padT),
      right: mix(from.padding.right, to.padding.right, padT),
    },
    offset: [
      mix(from.offset[0], to.offset[0], pitchT),
      mix(from.offset[1], to.offset[1], pitchT),
    ],
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
