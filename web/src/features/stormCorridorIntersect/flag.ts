import { safeStorage } from "../../storage/safeStorage";

const LS_KEY = "stormpath-storm-corridor-intersect";

/**
 * Experimental storm intersect — ON by default while we trial it.
 * Disable: `VITE_STORM_CORRIDOR_INTERSECT=false` or localStorage `stormpath-storm-corridor-intersect=0`
 */
export function isStormCorridorIntersectEnabled(): boolean {
  if (import.meta.env.VITE_STORM_CORRIDOR_INTERSECT === "false") return false;
  if (safeStorage.get(LS_KEY) === "0") return false;
  return true;
}
