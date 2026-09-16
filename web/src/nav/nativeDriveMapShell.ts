/**
 * Which map paints Drive after Go — StormPath's own map, or Mapbox's
 * NavigationMapView underneath the WebView.
 *
 * One owner is the rule that made Drive reliable, and it lives on the Core side:
 * Core owns snap / position / follow-cam samples / voice / reroute / stop, and the
 * web map only applies what it is handed. That holds no matter which map draws, so
 * the native shell is off — two live maps stacked with a punched hole is what makes
 * Drive flicker and show the old image through. Flip this back on to A/B the native
 * renderer; the whole path is still here.
 */
export const NATIVE_DRIVE_MAP_ENABLED = false;
/**
 * Drive camera comes from Core's map-matched sample rather than a JS follow-cam
 * computed off raw GPS. With the native shell off, the web map applies the sample
 * (see `shouldUseNativeFollowCam`); with it on, iOS writes it to the native map.
 */
export const NATIVE_DRIVE_FOLLOW_CAM_ENABLED = true;
/**
 * Extra UIKit chevron above the WebView. Off — it covers About / weather, and the
 * web map draws its own puck.
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
