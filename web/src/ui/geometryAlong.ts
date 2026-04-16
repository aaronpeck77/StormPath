import type { LngLat } from "../nav/types";

/** Point along polyline by fraction of total chord length [0,1]. */
export function pointAlongPolyline(geometry: LngLat[], fraction: number): LngLat | null {
  if (geometry.length === 0) return null;
  if (geometry.length === 1) return geometry[0]!;

  const t = Math.max(0, Math.min(1, fraction));
  let total = 0;
  const segLens: number[] = [];
  for (let i = 0; i < geometry.length - 1; i++) {
    const [lng1, lat1] = geometry[i]!;
    const [lng2, lat2] = geometry[i + 1]!;
    const d = Math.hypot(lng2 - lng1, lat2 - lat1);
    segLens.push(d);
    total += d;
  }
  if (total === 0) return geometry[0]!;

  let target = total * t;
  for (let i = 0; i < segLens.length; i++) {
    const sl = segLens[i]!;
    if (target <= sl) {
      const u = sl > 0 ? target / sl : 0;
      const [lng1, lat1] = geometry[i]!;
      const [lng2, lat2] = geometry[i + 1]!;
      return [lng1 + (lng2 - lng1) * u, lat1 + (lat2 - lat1) * u];
    }
    target -= sl;
  }
  return geometry[geometry.length - 1]!;
}
