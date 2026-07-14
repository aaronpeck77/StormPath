/**
 * StormPath view-mode contract — single source of truth for Dr / Mp / Rt behavior.
 *
 * Complements {@link navigationContract} (which owns *route-lock* rules). This module
 * owns *view* rules: which mode fits the whole trip, which mode uses a truncated ahead
 * line, when the user-explore latch blocks programmatic camera moves, and which
 * overlays are allowed in each mode.
 *
 * Consumers (camera helpers, route line rendering, DriveMap effects) should call these
 * functions instead of open-coding `viewMode === "topdown"` special cases. That is how
 * Mp keeps drifting back to Dr's ahead-slice or Rt's continent zoom — copies of the
 * rules living in three different files fall out of sync.
 *
 * Vocabulary (matches BottomToolbar labels):
 * - Rt = `"route"`   — Route overview
 * - Mp = `"topdown"` — Map (puck-centered top-down)
 * - Dr = `"drive"`   — Drive (3D follow-cam)
 */

import type { MapViewMode } from "../ui/driveMapTypes";

export type ViewModePhase = "planning" | "navigating";

export function viewModePhase(navigationStarted: boolean): ViewModePhase {
  return navigationStarted ? "navigating" : "planning";
}

/* --------------------------------------------------------------------------------
 * Camera framing
 * ------------------------------------------------------------------------------ */

/**
 * Rt while navigating: fit the full remaining trip corridor. Mp / Dr never do this —
 * Mp stays street-level on the puck; Dr uses its own 3D follow camera.
 */
export function shouldFitFullRouteCorridor(
  viewMode: MapViewMode,
  navigationStarted: boolean
): boolean {
  return navigationStarted && viewMode === "route";
}

/**
 * Mp while navigating: keep the puck centered at a street-level zoom. Never fit the
 * whole trip. Coming from Rt's continent overview, the first paint must re-home to
 * street zoom instead of inheriting the wide framing.
 */
export function shouldFollowPuckTopdown(
  viewMode: MapViewMode,
  navigationStarted: boolean
): boolean {
  return navigationStarted && viewMode === "topdown";
}

/**
 * Dr while navigating: use the 3D follow camera (pitch + bearing). Owned by the drive
 * camera module; other views must not attempt to drive it.
 */
export function shouldUseDriveFollowCamera(
  viewMode: MapViewMode,
  navigationStarted: boolean
): boolean {
  return navigationStarted && viewMode === "drive";
}

/**
 * Switching into Mp from any other view (Rt overview especially) should force a
 * one-shot re-home to street-level zoom on the puck. Without this the map keeps Rt's
 * ~6.9 continent zoom.
 */
export function shouldForceTopdownStreetZoomOnEnter(
  prevViewMode: MapViewMode | null,
  nextViewMode: MapViewMode,
  navigationStarted: boolean
): boolean {
  if (!navigationStarted) return false;
  if (nextViewMode !== "topdown") return false;
  return prevViewMode !== "topdown";
}

/* --------------------------------------------------------------------------------
 * Route line geometry
 * ------------------------------------------------------------------------------ */

export type RouteLineGeometryKind =
  | "driveAhead" /** Dr: short tail behind + ~120 km ahead window on long trips (perf). */
  | "overview"; /** Rt + Mp: full trip polyline (subsampled at the ultra-long cap). */

/**
 * Which route-line geometry to render for a given view.
 *
 * Rule: **only Dr** uses the truncated ahead slice. Mp and Rt keep the full overview
 * polyline so a pinch-out on Mp shows the whole corridor instead of a stub.
 *
 * Corner PiP always uses overview regardless of the underlying view.
 */
export function routeLineGeometryKind(
  viewMode: MapViewMode,
  navigationStarted: boolean,
  opts?: { isOverviewPip?: boolean; userAlongMeters?: number | null }
): RouteLineGeometryKind {
  if (opts?.isOverviewPip) return "overview";
  if (!navigationStarted) return "overview";
  if (viewMode !== "drive") return "overview";
  const along = opts?.userAlongMeters;
  if (along == null || !Number.isFinite(along)) return "overview";
  return "driveAhead";
}

/* --------------------------------------------------------------------------------
 * Explore latch
 * ------------------------------------------------------------------------------ */

/**
 * When the driver pans/zooms the map, an "explore latch" blocks programmatic camera
 * moves so the automatic follow doesn't fight the gesture. Rules:
 *
 * - Latch is respected during passive follow (GPS tick, view idle).
 * - App-driven refits (reroute, slot change, view mode switch) MUST win over a stale
 *   latch — otherwise the user gets a wrong framing until they pan again.
 */
export function programmaticCameraOverridesExploreLatch(
  reason:
    | "viewModeSwitch"
    | "reroute"
    | "slotChange"
    | "navigationStart"
    | "navigationStop"
    | "gpsTick"
    | "styleReload"
): boolean {
  switch (reason) {
    case "viewModeSwitch":
    case "reroute":
    case "slotChange":
    case "navigationStart":
    case "navigationStop":
    case "styleReload":
      return true;
    case "gpsTick":
      return false;
  }
}

/**
 * When a view switch happens, the explore latch from the previous view should be
 * cleared so the new view's default framing runs immediately.
 */
export function shouldClearExploreLatchOnViewSwitch(
  prevViewMode: MapViewMode | null,
  nextViewMode: MapViewMode
): boolean {
  if (prevViewMode == null) return true;
  return prevViewMode !== nextViewMode;
}

/* --------------------------------------------------------------------------------
 * Overlays / alternates
 * ------------------------------------------------------------------------------ */

/**
 * Alternate legs (B/C) are shown in Rt and Mp for the compare picker. Dr shows only
 * the locked leg ahead — alternate legs would clutter the follow cam and confuse the
 * driver about which line is theirs.
 *
 * Mirrors {@link navigationContract.mayRefreshAlternateLegsOnly} for camera/render
 * purposes.
 */
export function showsAlternateLegs(
  viewMode: MapViewMode,
  navigationStarted: boolean
): boolean {
  if (!navigationStarted) return true;
  return viewMode === "route" || viewMode === "topdown";
}

/**
 * Route-condition halos (weather bands drawn along the route line) are expensive to
 * clip and irrelevant in Dr where the truncated ahead-slice already carries them.
 * Rt + Mp render halos on the full overview polyline.
 */
export function showsRouteConditionHighlights(
  viewMode: MapViewMode,
  navigationStarted: boolean
): boolean {
  if (!navigationStarted) return viewMode !== "drive";
  return viewMode === "route" || viewMode === "topdown";
}

/**
 * Radar motion arrows / storm-motion overlay are visible in every navigating view.
 * Planning shows them in Rt/Mp only (Dr is off outside navigation).
 */
export function showsRadarMotionOverlay(
  viewMode: MapViewMode,
  navigationStarted: boolean
): boolean {
  if (navigationStarted) return true;
  return viewMode !== "drive";
}
