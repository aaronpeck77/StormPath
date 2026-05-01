import type { NormalizedWeatherAlert } from "./types";
import { rankNwsSeverity } from "./geometryOverlap";

/**
 * NWS products Basic users may see in the advisory strip and on the map (life-safety and
 * “do not keep from the driver” class). Plus users still receive the full unfiltered set.
 */
export function nwsAlertIsBasicEmergency(a: NormalizedWeatherAlert): boolean {
  if (a.severity === "Extreme") return true;

  const sev = rankNwsSeverity(a.severity);
  const ev = a.event?.trim() ?? "";
  if (!ev) return false;

  if (/tornado warning/i.test(ev)) return true;
  if (/tornado watch/i.test(ev)) return true;
  if (/severe thunderstorm warning/i.test(ev)) return true;
  if (/severe thunderstorm watch/i.test(ev)) return true;
  if (/extreme wind warning/i.test(ev)) return true;
  if (/snow squall warning/i.test(ev)) return true;
  if (/blizzard warning/i.test(ev)) return true;
  if (/ice storm warning/i.test(ev)) return true;
  if (/flash flood emergency/i.test(ev)) return true;
  if (/flash flood warning/i.test(ev) && sev >= 3) return true;
  if (/tsunami warning/i.test(ev)) return true;
  if (/hurricane warning|typhoon warning|tropical storm warning/i.test(ev)) return true;
  if (/hurricane watch|typhoon watch|tropical storm watch/i.test(ev)) return true;
  if (/storm surge warning/i.test(ev)) return true;
  if (/earthquake/i.test(ev)) return true;
  if (/civil emergency message|law enforcement warning|nuclear power plant|hazardous materials|911/i.test(ev))
    return true;

  const caps = `${a.headline}\n${a.description}`;
  if (
    /particularly dangerous situation|PDS/i.test(caps) &&
    /(tornado|thunderstorm|severe)/i.test(ev)
  ) {
    return true;
  }

  return false;
}

/** Map overlay: only polygons for alerts that pass {@link nwsAlertIsBasicEmergency}. */
export function filterMapGeoJsonToBasicEmergencies(
  collection: GeoJSON.FeatureCollection | null,
  alerts: NormalizedWeatherAlert[]
): GeoJSON.FeatureCollection | null {
  if (!collection?.features?.length) return collection;
  const allow = new Set(alerts.filter(nwsAlertIsBasicEmergency).map((x) => x.id));
  const features = collection.features.filter((f) => {
    const id = String((f.properties as { id?: string } | undefined)?.id ?? "");
    return id && allow.has(id);
  });
  return { type: "FeatureCollection", features } as GeoJSON.FeatureCollection;
}
