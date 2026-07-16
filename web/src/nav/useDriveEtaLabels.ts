import { useMemo } from "react";
import type { LngLat, NavRoute } from "./types";
import type { ScoredRoute } from "../scoring/scoreRoutes";
import type { TrafficOverlay } from "../situation/fusedSnapshot";
import {
  computeRemainingDistanceMeters,
  computeRemainingDriveEtaMinutes,
} from "./tripNavDisplay";
import { formatDistanceShort, useMilesForLngLat } from "../utils/formatDistance";

export interface UseDriveEtaLabelsDeps {
  navigationStarted: boolean;
  scored: ScoredRoute[];
  lineFocusId: string;
  guidanceRoute: NavRoute | undefined;
  guidanceRouteLengthM: number;
  userAlongGuidanceM: number;
  trafficOverlay: TrafficOverlay | undefined;
  effectiveUserLngLat: LngLat | null;
}

export interface UseDriveEtaLabelsResult {
  driveEtaMinutes: number | null;
  driveDistanceRemainingLabel: string | null;
}

/** Live remaining-leg ETA + distance labels shown on the drive HUD. */
export function useDriveEtaLabels(deps: UseDriveEtaLabelsDeps): UseDriveEtaLabelsResult {
  const {
    navigationStarted,
    scored,
    lineFocusId,
    guidanceRoute,
    guidanceRouteLengthM,
    userAlongGuidanceM,
    trafficOverlay,
    effectiveUserLngLat,
  } = deps;

  /** Live Mapbox remaining-leg minutes when available; else scale static / full-route ETA by distance left. */
  const driveEtaMinutes = useMemo(() => {
    const s = scored.find((x) => x.route.id === lineFocusId);
    const full = s
      ? Math.round(s.effectiveEtaMinutes)
      : guidanceRoute
        ? Math.round(guidanceRoute.baseEtaMinutes)
        : null;
    const trafficLeg = trafficOverlay?.[lineFocusId] ?? null;
    const liveRemaining =
      navigationStarted &&
      trafficLeg?.mapboxDurationMinutes != null &&
      Number.isFinite(trafficLeg.mapboxDurationMinutes)
        ? trafficLeg.mapboxDurationMinutes
        : null;
    return computeRemainingDriveEtaMinutes({
      navigationStarted,
      fullEtaMinutes: full,
      routeLengthM: guidanceRouteLengthM,
      alongM: userAlongGuidanceM,
      hasRouteGeometry: Boolean(guidanceRoute?.geometry?.length),
      liveRemainingEtaMinutes: liveRemaining,
    });
  }, [
    navigationStarted,
    scored,
    lineFocusId,
    guidanceRoute,
    guidanceRouteLengthM,
    userAlongGuidanceM,
    trafficOverlay,
  ]);

  const driveDistanceRemainingLabel = useMemo(() => {
    const rem = computeRemainingDistanceMeters(
      navigationStarted,
      guidanceRouteLengthM,
      userAlongGuidanceM
    );
    if (rem == null) return null;
    return formatDistanceShort(rem, useMilesForLngLat(effectiveUserLngLat));
  }, [navigationStarted, guidanceRouteLengthM, userAlongGuidanceM, effectiveUserLngLat]);

  return { driveEtaMinutes, driveDistanceRemainingLabel };
}
