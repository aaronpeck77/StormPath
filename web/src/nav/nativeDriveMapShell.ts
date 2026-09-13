/**
 * Native NavigationMapView under the WebView after Go (Drive only).
 * Off: Core still owns snap / reroute, but the visible Drive map stays web so
 * pitch-64 + 3D buildings + the StormPath puck actually show. Native streets
 * were punching through as a flat 2D camera.
 */
export const NATIVE_DRIVE_MAP_ENABLED = false;
/** Native follow-cam writes every tick and flickers the web map. Use JS follow-cam. */
export const NATIVE_DRIVE_FOLLOW_CAM_ENABLED = false;
/** Swift chevron sits above the WebView — it covers About / weather. Use the web puck. */
export const NATIVE_DRIVE_PUCK_OVERLAY_ENABLED = false;

/**
 * Visible native Drive map. Off until the native style/camera matches StormPath 3D.
 * Core still owns snap / reroute regardless of this flag.
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
