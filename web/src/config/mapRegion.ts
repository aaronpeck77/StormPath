import { continentFromLngLat, type ContinentCode } from "../services/continents";
import type { LngLat } from "../nav/types";

/** Mapbox `maxBounds` — southwest corner, northeast corner. */
export type MapLngLatBounds = [[number, number], [number, number]];

/** World bounds — no pan restriction (ocean / unknown fix). */
export const WORLD_BOUNDS: MapLngLatBounds = [
  [-180, -85],
  [180, 85],
];

/**
 * Map pan limits per continent — same coarse boxes as {@link continentFromLngLat}.
 * NA includes US, Canada, Mexico, Central America, Caribbean, and Greenland.
 */
export const CONTINENT_MAP_BOUNDS: Readonly<Record<ContinentCode, MapLngLatBounds>> = {
  NA: [
    [-168, 7],
    [-52, 84],
  ],
  SA: [
    [-82, -56],
    [-34, 13],
  ],
  EU: [
    [-25, 35],
    [60, 72],
  ],
  AF: [
    [-18, -35],
    [52, 38],
  ],
  /** Pacific rim — covers both OC classifier boxes (Australia–NZ and eastern Pacific islands). */
  OC: [
    [-180, -50],
    [180, 10],
  ],
  AS: [
    [26, -11],
    [180, 78],
  ],
};

/** Degrees of padding so border states / short cross-border hops don't feel clipped. */
export const MAP_BOUNDS_PAD_DEG = 3;

export function padMapBounds(
  bounds: MapLngLatBounds,
  padDeg = MAP_BOUNDS_PAD_DEG
): MapLngLatBounds {
  const [[west, south], [east, north]] = bounds;
  return [
    [Math.max(-180, west - padDeg), Math.max(-85, south - padDeg)],
    [Math.min(180, east + padDeg), Math.min(85, north + padDeg)],
  ];
}

/** Primary map pan limit from the user's GPS fix — falls back to world when unknown. */
export function mapMaxBoundsForLngLat(lngLat: LngLat | null | undefined): MapLngLatBounds {
  const code = continentFromLngLat(lngLat);
  if (!code) return WORLD_BOUNDS;
  return padMapBounds(CONTINENT_MAP_BOUNDS[code]);
}

/** Floor zoom so active navigation can't pull back to a whole-world view. */
export function mapMinZoomForSession(opts: {
  navigationStarted: boolean;
  hasContinent: boolean;
}): number {
  if (opts.navigationStarted && opts.hasContinent) return 5;
  if (opts.hasContinent) return 3;
  return 2;
}

/** @deprecated Use {@link mapMaxBoundsForLngLat} — kept for small PiP maps defaulting to NA. */
export const NORTH_AMERICA_BOUNDS = padMapBounds(CONTINENT_MAP_BOUNDS.NA);

export function lngLatInNorthAmerica(lng: number, lat: number): boolean {
  return continentFromLngLat([lng, lat]) === "NA";
}
