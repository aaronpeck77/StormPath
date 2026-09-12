/** Native NavigationMapView under the WebView after Go (Drive only). */
export const NATIVE_DRIVE_MAP_ENABLED = true;
/** Native follow-cam writes every tick and flickers the web map. Use JS follow-cam. */
export const NATIVE_DRIVE_FOLLOW_CAM_ENABLED = false;
/** Swift chevron sits above the WebView — it covers About / weather. Use the web puck. */
export const NATIVE_DRIVE_PUCK_OVERLAY_ENABLED = false;

/** True when Drive should punch a hole in the WebView and show the iOS NavigationMapView. */
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
