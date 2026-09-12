/** True when Drive should punch a hole in the WebView and show the iOS NavigationMapView. */
export function shouldUseNativeDriveMapShell(input: {
  nativeNavActive: boolean;
  navigationStarted: boolean;
  viewMode: string;
}): boolean {
  return Boolean(
    input.nativeNavActive && input.navigationStarted && input.viewMode === "drive"
  );
}
