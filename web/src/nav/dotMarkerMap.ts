/**
 * Map-side DOT triangle positions — always re-derived from along-route meters
 * on the focus geometry the map is painting. Never trust a stored impact.lngLat
 * that may have been snapped to a previous trip's corridor (Guatemala column).
 */
import { pointAtAlongMeters } from "./routeGeometry";
import type { RouteImpact } from "./routeImpacts";
import type { LngLat } from "./types";

export type DotMapMarker = {
  id: string;
  lngLat: LngLat;
  label: string;
  kind?: "construction" | "closure" | "incident" | "other";
};

function markerKind(
  category: RouteImpact["category"]
): DotMapMarker["kind"] {
  if (
    category === "closure" ||
    category === "incident" ||
    category === "construction"
  ) {
    return category;
  }
  return "other";
}

function isFiniteLngLat(p: LngLat): boolean {
  return (
    Number.isFinite(p[0]) &&
    Number.isFinite(p[1]) &&
    Math.abs(p[0]) <= 180 &&
    Math.abs(p[1]) <= 90
  );
}

/**
 * Build map markers from corridor impacts by projecting each event's
 * alongMeters onto the current focus polyline.
 */
export function dotMarkersAlongFocusGeometry(
  impacts: readonly RouteImpact[],
  focusGeometry: LngLat[] | null | undefined
): DotMapMarker[] {
  if (!focusGeometry || focusGeometry.length < 2) return [];
  const out: DotMapMarker[] = [];
  for (const impact of impacts) {
    if (impact.source !== "dot511") continue;
    if (!Number.isFinite(impact.alongMeters)) continue;
    const lngLat = pointAtAlongMeters(
      focusGeometry,
      Math.max(0, impact.alongMeters)
    );
    if (!isFiniteLngLat(lngLat)) continue;
    out.push({
      id: impact.id,
      lngLat,
      label: impact.driverHeadline,
      kind: markerKind(impact.category),
    });
  }
  return out;
}

/**
 * Geometry the map paints for the focused leg — same rewrite driveMapRoutesForMap
 * applies (nav guidance overwrites the guidance slot). Used for DOT matching so
 * matchGeom cannot drift from the blue line on screen.
 */
export function focusGeometryForDotMatch(input: {
  navigationStarted: boolean;
  focusId: string | null | undefined;
  guidanceRouteId: string | null | undefined;
  navigationGuidanceGeometry: LngLat[] | null | undefined;
  planRoutes: readonly { id: string; geometry?: LngLat[] }[];
}): LngLat[] | undefined {
  const focusId = input.focusId?.trim() || null;
  const guidanceId = input.guidanceRouteId?.trim() || null;
  const navGeom = input.navigationGuidanceGeometry;
  if (
    input.navigationStarted &&
    focusId &&
    guidanceId &&
    focusId === guidanceId &&
    navGeom &&
    navGeom.length >= 2
  ) {
    return navGeom;
  }
  const fromFocus = focusId
    ? input.planRoutes.find((r) => r.id === focusId)?.geometry
    : undefined;
  if (fromFocus && fromFocus.length >= 2) return fromFocus;
  const fromGuidance = guidanceId
    ? input.planRoutes.find((r) => r.id === guidanceId)?.geometry
    : undefined;
  if (fromGuidance && fromGuidance.length >= 2) return fromGuidance;
  const first = input.planRoutes[0]?.geometry;
  return first && first.length >= 2 ? first : undefined;
}
