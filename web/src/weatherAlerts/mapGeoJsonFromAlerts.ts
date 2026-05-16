import { nwsMapKindFromEvent } from "./nwsMapKind";
import type { NormalizedWeatherAlert } from "./types";

/** Build map layers directly from normalized alerts (fallback when corridor GeoJSON ids drift). */
export function mapGeoJsonFromAlerts(alerts: NormalizedWeatherAlert[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const a of alerts) {
    if (!a.geometry) continue;
    features.push({
      type: "Feature",
      id: a.id,
      properties: {
        id: a.id,
        event: a.event,
        headline: a.headline,
        severity: a.severity,
        kind: nwsMapKindFromEvent(a.event),
        motionDeg: a.stormMotionDeg ?? null,
        motionMph: a.stormMotionMph ?? null,
      },
      geometry: a.geometry,
    });
  }
  return { type: "FeatureCollection", features };
}
