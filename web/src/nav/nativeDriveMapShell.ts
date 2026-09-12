/** Flip on after `NavigationMapView` archives. Until then Drive stays on the web map. */
export const NATIVE_DRIVE_MAP_ENABLED = false;

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
