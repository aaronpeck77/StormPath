import { safeStorage } from "../storage/safeStorage";

export const MAP_STYLE_DAY = "mapbox://styles/mapbox/streets-v12";

/**
 * Night basemap preset — persists under {@link NIGHT_MAP_STYLE_LS_KEY}.
 * URL override on load: `?mapNight=neutral` | `navigation` | `streets` (aliases: `dark`, `nav`, `day`).
 */
export type NightBasemapPreset = "neutral" | "navigation" | "streets";

export const NIGHT_MAP_STYLE_LS_KEY = "stormpath-map-night-style";

export function nightBasemapStyleUrl(preset: NightBasemapPreset): string {
  switch (preset) {
    case "navigation":
      return "mapbox://styles/mapbox/navigation-night-v1";
    case "streets":
      return MAP_STYLE_DAY;
    default:
      return "mapbox://styles/mapbox/dark-v11";
  }
}

export function parseNightBasemapPreset(): NightBasemapPreset {
  if (typeof window === "undefined") return "neutral";
  try {
    const q = new URLSearchParams(window.location.search).get("mapNight");
    if (q === "navigation" || q === "nav") return "navigation";
    if (q === "streets" || q === "day") return "streets";
    if (q === "neutral" || q === "dark") return "neutral";
  } catch {
    /* ignore URL parse */
  }
  const ls = safeStorage.get(NIGHT_MAP_STYLE_LS_KEY);
  if (ls === "navigation" || ls === "streets" || ls === "neutral") return ls;
  return "neutral";
}

/** Day vs night for style + 3D lighting (local time). */
export type MapPhase = "day" | "night";

export function currentMapPhase(): MapPhase {
  const h = new Date().getHours();
  return h >= 6 && h < 20 ? "day" : "night";
}

export function currentMapStyle(phase: MapPhase | undefined, nightPreset: NightBasemapPreset): string {
  const ph = phase ?? currentMapPhase();
  return ph === "night" ? nightBasemapStyleUrl(nightPreset) : MAP_STYLE_DAY;
}

/** Mapbox light position & color for each phase. */
export function sceneLightForPhase(phase: MapPhase): {
  anchor: "map" | "viewport";
  position: [number, number, number];
  color: string;
  intensity: number;
} {
  if (phase === "night") {
    return { anchor: "map", position: [1.5, 210, 55], color: "#8899cc", intensity: 0.34 };
  }
  return { anchor: "map", position: [1.5, 180, 28], color: "white", intensity: 0.5 };
}

export function buildingColorForPhase(phase: MapPhase): string {
  return phase === "night" ? "#2a2e38" : "#d4d4d8";
}
