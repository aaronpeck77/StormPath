import type { LngLat } from "./types";

/** Coordinates from just before the closest vertex to the user through the destination (remaining path). */
export function sliceRouteAhead(geometry: LngLat[], userLngLat: LngLat): LngLat[] {
  if (geometry.length < 2) return geometry;
  let bestI = 0;
  let bestD = Infinity;
  for (let i = 0; i < geometry.length; i++) {
    const [lng, lat] = geometry[i]!;
    const d = (lng - userLngLat[0]) ** 2 + (lat - userLngLat[1]) ** 2;
    if (d < bestD) {
      bestD = d;
      bestI = i;
    }
  }
  const start = Math.max(0, bestI - 1);
  return geometry.slice(start);
}
