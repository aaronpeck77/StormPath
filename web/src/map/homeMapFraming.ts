import { safeStorage } from "../storage/safeStorage";

const LS_HOME_MAP_FRAMING = "stormpath-home-map-framing";

/** How the map frames itself on launch and whenever there is no active trip. */
export type HomeMapFraming = "auto" | "my_location" | "activity_area";

export function readHomeMapFraming(): HomeMapFraming {
  const v = safeStorage.get(LS_HOME_MAP_FRAMING);
  if (v === "my_location" || v === "activity_area" || v === "auto") return v;
  return "auto";
}

export function writeHomeMapFraming(mode: HomeMapFraming): void {
  safeStorage.set(LS_HOME_MAP_FRAMING, mode);
}

export function resolveIdleHomeFraming(
  pref: HomeMapFraming,
  trailBounds: [[number, number], [number, number]] | null | undefined
): "my_location" | "activity_area" {
  if (pref === "my_location") return "my_location";
  if (pref === "activity_area") return trailBounds ? "activity_area" : "my_location";
  return trailBounds ? "activity_area" : "my_location";
}
