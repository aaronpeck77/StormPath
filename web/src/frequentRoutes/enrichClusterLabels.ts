import { mapboxReverseGeocode } from "../services/mapboxGeocode";
import { shortenPlaceNameForForecast } from "../utils/forecastDisplay";
import type { FrequentRouteCluster } from "./types";

/**
 * Fill missing start/end place names via Mapbox reverse geocode.
 * Returns null when nothing changed or both lookups failed.
 */
export async function enrichFrequentClusterLabels(
  cluster: FrequentRouteCluster,
  accessToken: string
): Promise<FrequentRouteCluster | null> {
  if (cluster.startLabel?.trim() && cluster.endLabel?.trim()) return null;

  let startLabel = cluster.startLabel?.trim() || "";
  let endLabel = cluster.endLabel?.trim() || "";

  const [startLng, startLat] = cluster.centerStart;
  const [endLng, endLat] = cluster.centerEnd;

  const jobs: Promise<void>[] = [];
  if (!startLabel) {
    jobs.push(
      mapboxReverseGeocode(startLng, startLat, accessToken).then((hit) => {
        if (hit?.placeName) startLabel = shortenPlaceNameForForecast(hit.placeName);
      })
    );
  }
  if (!endLabel) {
    jobs.push(
      mapboxReverseGeocode(endLng, endLat, accessToken).then((hit) => {
        if (hit?.placeName) endLabel = shortenPlaceNameForForecast(hit.placeName);
      })
    );
  }
  await Promise.all(jobs);

  if (!startLabel && !endLabel) return null;
  if (startLabel === (cluster.startLabel ?? "") && endLabel === (cluster.endLabel ?? "")) {
    return null;
  }

  return {
    ...cluster,
    startLabel: startLabel || cluster.startLabel,
    endLabel: endLabel || cluster.endLabel,
  };
}

/** Display line for a cluster — prefers place names, falls back to coords. */
export function formatFrequentClusterEndpoints(
  cluster: FrequentRouteCluster,
  formatCoords: (lng: number, lat: number) => string
): { from: string; to: string } {
  const from =
    cluster.startLabel?.trim() ||
    formatCoords(cluster.centerStart[0], cluster.centerStart[1]);
  const to =
    cluster.endLabel?.trim() || formatCoords(cluster.centerEnd[0], cluster.centerEnd[1]);
  return { from, to };
}
