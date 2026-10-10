import { useEffect, useMemo, useRef } from "react";
import type { LngLat, NavRoute } from "./types";
import type { ScoredRoute } from "../scoring/scoreRoutes";
import type { TrafficOverlay } from "../situation/fusedSnapshot";
import {
  computeRemainingDistanceMeters,
  computeRemainingDriveEtaMinutes,
  easeRemainingEtaMinutes,
  emptyEtaEaseState,
} from "./tripNavDisplay";
import { formatDistanceShort, useMilesForLngLat } from "../utils/formatDistance";
import { noteDriveDiagEta } from "./driveDiagnostics";

export interface UseDriveEtaLabelsDeps {
  navigationStarted: boolean;
  scored: ScoredRoute[];
  lineFocusId: string;
  guidanceRoute: NavRoute | undefined;
  guidanceRouteLengthM: number;
  /** Longest planned leg. The live corridor is often much shorter. */
  planLengthM: number;
  userAlongGuidanceM: number;
  /** Meters already driven. Keeps a full-line along reset from restoring the whole trip clock. */
  tripOdometerM: number;
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
    planLengthM,
    userAlongGuidanceM,
    tripOdometerM,
    trafficOverlay,
    effectiveUserLngLat,
  } = deps;

  const etaEaseRef = useRef(emptyEtaEaseState());

  /** Live Mapbox remaining-leg minutes when they match the road still left; else scale the planned trip. */
  const rawDriveEtaMinutes = useMemo(() => {
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
    const typicalRemaining =
      liveRemaining != null &&
      trafficLeg?.typicalDurationMinutes != null &&
      Number.isFinite(trafficLeg.typicalDurationMinutes)
        ? trafficLeg.typicalDurationMinutes
        : null;
    return computeRemainingDriveEtaMinutes({
      navigationStarted,
      fullEtaMinutes: full,
      routeLengthM: guidanceRouteLengthM,
      alongM: userAlongGuidanceM,
      hasRouteGeometry: Boolean(guidanceRoute?.geometry?.length),
      planLengthM,
      tripOdometerM,
      liveRemainingEtaMinutes: liveRemaining,
      typicalRemainingMinutes: typicalRemaining,
    });
  }, [
    navigationStarted,
    scored,
    lineFocusId,
    guidanceRoute,
    guidanceRouteLengthM,
    planLengthM,
    userAlongGuidanceM,
    tripOdometerM,
    trafficOverlay,
  ]);

  const distanceLeftM = computeRemainingDistanceMeters(
    navigationStarted,
    guidanceRouteLengthM,
    userAlongGuidanceM
  );
  if (!navigationStarted) etaEaseRef.current = emptyEtaEaseState();
  const driveEtaMinutes = easeRemainingEtaMinutes(
    etaEaseRef.current,
    rawDriveEtaMinutes,
    distanceLeftM,
    Date.now()
  );

  useEffect(() => {
    if (!navigationStarted || driveEtaMinutes == null) return;
    const distanceLeftMForNote = computeRemainingDistanceMeters(
      true,
      guidanceRouteLengthM,
      userAlongGuidanceM
    );
    const leg = trafficOverlay?.[lineFocusId] ?? null;
    const liveMin = leg?.mapboxDurationMinutes;
    const source =
      liveMin != null && Number.isFinite(liveMin) && driveEtaMinutes === Math.round(liveMin)
        ? "live"
        : "line";
    noteDriveDiagEta(driveEtaMinutes, distanceLeftMForNote, source);
  }, [
    navigationStarted,
    driveEtaMinutes,
    guidanceRouteLengthM,
    userAlongGuidanceM,
    trafficOverlay,
    lineFocusId,
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
