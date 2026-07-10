/**
 * Experimental storm-intersect overlay on Route Info — disabled.
 * Purple/green bands and enter lines were unclear and often wrong.
 * Re-enable only behind an explicit env flag when the feature is ready.
 */
export function isStormCorridorIntersectEnabled(): boolean {
  return import.meta.env.VITE_STORM_CORRIDOR_INTERSECT === "true";
}
