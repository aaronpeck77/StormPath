import type { NormalizedWeatherAlert } from "./types";

export function buildAvoidMultiPolygon(alerts: NormalizedWeatherAlert[]): GeoJSON.MultiPolygon | null {
  const polys: GeoJSON.Polygon[] = [];

  for (const a of alerts) {
    const g = a.geometry;
    if (!g) continue;
    if (g.type === "Polygon") {
      polys.push(g);
    } else if (g.type === "MultiPolygon") {
      for (const coords of g.coordinates) {
        polys.push({ type: "Polygon", coordinates: coords });
      }
    }
  }

  if (polys.length === 0) return null;

  return {
    type: "MultiPolygon",
    coordinates: polys.map((p) => p.coordinates),
  };
}

