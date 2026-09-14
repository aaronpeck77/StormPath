/**
 * Native NavigationMapView under the WebView after Go (Drive only).
 * One owner: Core owns snap / line / puck / follow-cam / stop. Web is chrome
 * (guidance, weather, About, Mp/Rt). Mp/Rt flip back to the web map.
 */
export const NATIVE_DRIVE_MAP_ENABLED = true;
/** iOS writes follow-cam onto the native map; web Drive must not easeTo. */
export const NATIVE_DRIVE_FOLLOW_CAM_ENABLED = true;
/**
 * Extra UIKit chevron above the WebView. Off — it covers About / weather.
 * NavigationMapView draws Mapbox's 3D navigation puck after Go.
 */
export const NATIVE_DRIVE_PUCK_OVERLAY_ENABLED = false;

/**
 * Visible native Drive map while Core is guiding in Dr.
 * Mp / Rt stay on the web map (this returns false).
 */
export function shouldUseNativeDriveMapShell(input: {
  nativeNavActive: boolean;
  navigationStarted: boolean;
  viewMode: string;
}): boolean {
  if (!NATIVE_DRIVE_MAP_ENABLED) return false;
  return Boolean(
    input.nativeNavActive && input.navigationStarted && input.viewMode === "drive"
  );
}
