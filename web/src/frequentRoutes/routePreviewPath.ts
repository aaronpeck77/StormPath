import type { LngLat } from "../nav/types";

/** Downsample a polyline to an SVG path in a fixed viewBox for list previews. */
export function geometryToPreviewPath(
  geometry: LngLat[],
  width = 56,
  height = 28,
  pad = 3
): string | null {
  if (geometry.length < 2) return null;

  const step = Math.max(1, Math.floor(geometry.length / 28));
  const pts: LngLat[] = [];
  for (let i = 0; i < geometry.length; i += step) {
    pts.push(geometry[i]!);
  }
  const last = geometry[geometry.length - 1]!;
  if (pts[pts.length - 1] !== last) pts.push(last);

  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of pts) {
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  const spanLng = Math.max(maxLng - minLng, 1e-6);
  const spanLat = Math.max(maxLat - minLat, 1e-6);
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;

  const parts: string[] = [];
  for (let i = 0; i < pts.length; i++) {
    const [lng, lat] = pts[i]!;
    const x = pad + ((lng - minLng) / spanLng) * innerW;
    /* SVG y grows downward — flip lat. */
    const y = pad + (1 - (lat - minLat) / spanLat) * innerH;
    parts.push(`${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return parts.join(" ");
}
