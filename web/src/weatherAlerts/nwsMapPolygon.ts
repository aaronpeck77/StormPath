import { nwsMapKindFromEvent } from "./nwsMapKind";

/**
 * Map polygons are Warning / Emergency only. Watches stay in the advisory list
 * so county-scale boxes do not cover Rt / Mp.
 */
export function nwsEventIsMapWarning(event: string): boolean {
  const e = event.trim();
  if (!e || /\bwatch\b/i.test(e)) return false;
  return /\b(warning|emergency)\b/i.test(e);
}

/**
 * Same draw gate as the Mapbox layers: convective + Severe/Extreme warnings,
 * plus Flash Flood Warning / Emergency at Severe+. Advisories and watches stay off the map.
 */
export function nwsAlertShowsOnMap(input: {
  event?: string;
  severity?: string;
  kind?: string;
}): boolean {
  const event = input.event?.trim() ?? "";
  if (!nwsEventIsMapWarning(event)) return false;

  const kind = input.kind && input.kind !== "other" ? input.kind : nwsMapKindFromEvent(event);
  const severity = input.severity ?? "";

  if (kind === "hydro") {
    return /flash\s+flood/i.test(event) && (severity === "Extreme" || severity === "Severe");
  }

  return kind === "convective" || severity === "Extreme" || severity === "Severe";
}

export function filterNwsMapWarningFeatures(
  collection: GeoJSON.FeatureCollection | null | undefined
): GeoJSON.FeatureCollection | null {
  if (!collection?.features?.length) return null;
  const features = collection.features.filter((f) =>
    nwsAlertShowsOnMap((f.properties ?? {}) as { event?: string; severity?: string; kind?: string })
  );
  if (!features.length) return null;
  return { type: "FeatureCollection", features };
}
