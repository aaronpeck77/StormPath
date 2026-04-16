/** NWS GeoJSON sometimes nests Polygon inside a GeometryCollection. */
export function extractPolygonalGeometry(
  geom: GeoJSON.Geometry | null | undefined
): GeoJSON.Polygon | GeoJSON.MultiPolygon | null {
  if (!geom) return null;
  if (geom.type === "Polygon" || geom.type === "MultiPolygon") return geom;
  if (geom.type === "GeometryCollection") {
    for (const sub of geom.geometries) {
      const found = extractPolygonalGeometry(sub);
      if (found) return found;
    }
  }
  return null;
}

export function mergePolygonalParts(
  parts: (GeoJSON.Polygon | GeoJSON.MultiPolygon)[]
): GeoJSON.MultiPolygon | null {
  const coords: GeoJSON.Position[][][] = [];
  for (const p of parts) {
    if (p.type === "Polygon") {
      coords.push(p.coordinates);
    } else {
      for (const poly of p.coordinates) {
        coords.push(poly);
      }
    }
  }
  if (!coords.length) return null;
  return { type: "MultiPolygon", coordinates: coords };
}
