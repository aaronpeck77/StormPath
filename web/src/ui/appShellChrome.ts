import type { CSSProperties } from "react";
import { DEV_CURSOR_DEFAULT, DEV_CURSOR_POINTER } from "../dev/devCursor";

export type AppShellClassNameFlags = {
  navigationStarted: boolean;
  isDriveView: boolean;
  isTopdownView: boolean;
  showProgressRail: boolean;
  trafficBypassCompareActive: boolean;
  basemapNight: boolean;
  landscapeHandLeft: boolean;
  radarFrameTimeVisible: boolean;
  basicAdBannerReservesSpace: boolean;
};

/** Root `.app-shell` class list — one flag per UI mode/overlay that changes shell layout. */
export function buildAppShellClassName(flags: AppShellClassNameFlags): string {
  const {
    navigationStarted,
    isDriveView,
    isTopdownView,
    showProgressRail,
    trafficBypassCompareActive,
    basemapNight,
    landscapeHandLeft,
    radarFrameTimeVisible,
    basicAdBannerReservesSpace,
  } = flags;
  return [
    "app-shell",
    "nav-fullmap",
    navigationStarted && isDriveView ? "nav-drive-ui" : "",
    navigationStarted && isTopdownView ? "nav-mapnav-ui" : "",
    showProgressRail ? "nav-progress-rail-on" : "",
    trafficBypassCompareActive ? "nav-route-compare-active" : "",
    basemapNight ? "app-shell--basemap-night" : "",
    landscapeHandLeft ? "app-shell--landscape-hand-left" : "",
    radarFrameTimeVisible ? "nav-radar-frame-time-visible" : "",
    basicAdBannerReservesSpace ? "app-shell--basic-ad-banner" : "",
    import.meta.env.DEV ? "app-shell--dev-pointer" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Dev-only cursor override so custom pointer glyphs don't leak into production builds. */
export function buildDevPointerStyle(): CSSProperties | undefined {
  if (!import.meta.env.DEV) return undefined;
  return {
    ["--sp-dev-cursor-default" as string]: DEV_CURSOR_DEFAULT,
    ["--sp-dev-cursor-pointer" as string]: DEV_CURSOR_POINTER,
  } as CSSProperties;
}
