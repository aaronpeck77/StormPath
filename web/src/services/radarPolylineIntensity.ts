import type { LngLat } from "../nav/types";
import { pointAlongPolyline } from "../ui/geometryAlong";
import { fetchRadarTileRgba } from "./rainViewerTileFetch";

export const RADAR_MOSAIC_SAMPLE_ZOOM = 7;

/**
 * Meaningful precip along the fastest route before we spend Directions calls on pure radar bypass
 * waypoints (when no NWS polygons apply).
 */
export const RADAR_PRIMARY_PRECIP_GATE = 0.38;

/** Fractions along polyline length used when scoring echoes (dense enough for mesoscale cells at z=7). */
export const RADAR_ROUTE_SAMPLE_FRACTIONS: readonly number[] = [
  0.03, 0.08, 0.13, 0.18, 0.23, 0.28, 0.33, 0.38, 0.43, 0.48, 0.53, 0.58, 0.63, 0.68, 0.73, 0.78,
  0.85, 0.92,
];

export function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/**
 * Echo strength from RainViewer tile RGBA — tuned conservative vs raw palette so light
 * precip and yellow–green fringe do not read as severe as storm cores on consumer apps.
 */
export function echoIntensityFromRgba(r: number, g: number, b: number, a: number): number {
  if (a < 20) return 0;
  const alpha = a / 255;
  const bright = (r + g + b) / (3 * 255);
  const warm = Math.max(0, r - Math.max(g, b) * 0.92) / 255;
  const raw = alpha * Math.max(bright * 0.92, warm * 1.48);
  return clamp01(Math.pow(raw, 1.2));
}

/**
 * Storm **core** strength (red / magenta / white hail) — ignores yellow–green fringe used for broad precip.
 * Motion arrows should anchor on this score, not {@link echoIntensityFromRgba}.
 */
export function stormCoreIntensityFromRgba(r: number, g: number, b: number, a: number): number {
  if (a < 18) return 0;
  const alpha = a / 255;
  const bright = (r + g + b) / (3 * 255);
  const warm = Math.max(0, r - Math.max(g, b) * 0.82) / 255;
  /* RainViewer palette: white / pink cores at extreme reflectivity */
  if (bright > 0.82 && r > 175 && a > 160) {
    return clamp01(0.88 + bright * 0.12);
  }
  if (warm < 0.26 || bright < 0.46) return 0;
  return clamp01(Math.pow(alpha * warm * 1.95, 1.12));
}

export function tileXY(lng: number, lat: number, z: number): { x: number; y: number; px: number; py: number } {
  const n = 2 ** z;
  const xFloat = ((lng + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const yFloat =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  const x = Math.floor(xFloat);
  const y = Math.floor(yFloat);
  const px = Math.max(0, Math.min(255, Math.floor((xFloat - x) * 256)));
  const py = Math.max(0, Math.min(255, Math.floor((yFloat - y) * 256)));
  return { x, y, px, py };
}

export { fetchRadarTileRgba, isRainViewerRateLimited } from "./rainViewerTileFetch";

/** Maximum mosaic echo intensity along `geometry` using RainViewer tile URLs (`{z}/{x}/{y}` placeholders). */
export async function sampleRadarMosaicMaxAlongPolyline(
  geometry: LngLat[],
  tileTemplateUrl: string,
  signal?: AbortSignal,
  opts?: { z?: number; fractions?: readonly number[] }
): Promise<number> {
  if (geometry.length < 2) return 0;
  const z = opts?.z ?? RADAR_MOSAIC_SAMPLE_ZOOM;
  const fractions = opts?.fractions ?? RADAR_ROUTE_SAMPLE_FRACTIONS;

  const pts = fractions
    .map((t) => ({ lngLat: pointAlongPolyline(geometry, t) }))
    .filter((x): x is { lngLat: LngLat } => Boolean(x.lngLat));

  const tileToSamples = new Map<string, { px: number; py: number }[]>();
  for (const p of pts) {
    const [lng, lat] = p.lngLat;
    const { x, y, px, py } = tileXY(lng, lat, z);
    const key = `${z}/${x}/${y}`;
    const arr = tileToSamples.get(key) ?? [];
    arr.push({ px, py });
    tileToSamples.set(key, arr);
  }

  let maxIntensity = 0;
  for (const [key, items] of tileToSamples) {
    if (signal?.aborted) return maxIntensity;
    const [zStr, xStr, yStr] = key.split("/");
    const url = tileTemplateUrl
      .replace("{z}", zStr!)
      .replace("{x}", xStr!)
      .replace("{y}", yStr!);
    const rgba = await fetchRadarTileRgba(url);
    for (const it of items) {
      if (!rgba) continue;
      const idx = (it.py * 256 + it.px) * 4;
      maxIntensity = Math.max(
        maxIntensity,
        echoIntensityFromRgba(rgba[idx] ?? 0, rgba[idx + 1] ?? 0, rgba[idx + 2] ?? 0, rgba[idx + 3] ?? 0)
      );
    }
  }
  return maxIntensity;
}
