import { useEffect, useMemo, useState } from "react";
import { pickDriveApproachBanner } from "./driveHazardApproachPreview";
import { earlyApproachMaxMetersForSpeed } from "./surgicalBypassWindow";
import { TRAFFIC_BYPASS_ENABLED } from "./constants";
import { polylineLengthMeters, pointAtAlongMeters } from "./routeGeometry";
import type { RouteImpact } from "./routeImpacts";
import type { LngLat, NavRoute } from "./types";

export type UseDriveApproachBannerDeps = {
  isPlus: boolean;
  navigationStarted: boolean;
  guidanceRoute: NavRoute | null | undefined;
  guidanceRouteId: string;
  userAlongGuidanceM: number;
  speedMps: number | null;
  routeImpactsForUi: RouteImpact[];
  demoBypassTrafficJamPlus: boolean;
  demoApproachBannerOn: boolean;
  demoCloseHazardOn: boolean;
};

/**
 * Drive approach banner pick — real hazards + optional `?demo=bypass` fabricated impact.
 */
export function useDriveApproachBanner(deps: UseDriveApproachBannerDeps) {
  const {
    isPlus,
    navigationStarted,
    guidanceRoute,
    guidanceRouteId,
    userAlongGuidanceM,
    speedMps,
    routeImpactsForUi,
    demoBypassTrafficJamPlus,
    demoApproachBannerOn,
    demoCloseHazardOn,
  } = deps;

  const [driveApproachDismissedIds, setDriveApproachDismissedIds] = useState(
    () => new Set<string>()
  );

  const hazardApproachAlertsActive =
    TRAFFIC_BYPASS_ENABLED &&
    isPlus &&
    navigationStarted &&
    Boolean(guidanceRoute?.geometry && guidanceRoute.geometry.length >= 2);

  const demoApproachBannerImpact = useMemo<RouteImpact | null>(() => {
    if (!demoBypassTrafficJamPlus) return null;
    const usingClose = demoCloseHazardOn;
    if (!usingClose && !demoApproachBannerOn) return null;
    const g = guidanceRoute?.geometry;
    if (!g?.length) return null;
    const totalM = polylineLengthMeters(g);
    const userAlong = Number.isFinite(userAlongGuidanceM) ? userAlongGuidanceM : 0;
    const aheadDistMi = usingClose ? 0.6 : 1.4;
    const ahead = Math.min(totalM - 100, userAlong + aheadDistMi * 1609.344);
    const distAhead = Math.max(0, ahead - userAlong);
    if (distAhead <= 200) return null;
    return {
      id: usingClose ? "demo-close-hazard" : "demo-approach-banner",
      category: "traffic",
      severity: "serious",
      confidence: "high",
      source: "mapboxTraffic",
      lngLat: pointAtAlongMeters(g, ahead) as LngLat,
      alongMeters: ahead,
      startMeters: ahead,
      endMeters: ahead,
      distanceAheadMeters: distAhead,
      etaAheadMinutes: null,
      driverHeadline: usingClose ? "Demo: hazard right ahead" : "Demo: heavy traffic ahead",
      driverAction: "rerouteRecommended",
      roadEffect: usingClose
        ? "Demo only — tests close-in next-exit bypass behavior."
        : "Demo only — tap to test the bypass options flow.",
      detail: usingClose
        ? "Mock close hazard ~0.6 mi ahead to exercise the adaptive surgical bypass."
        : "Mock impact to drive the approach banner / compare-panel UI without a real-world hazard.",
      numericSeverity: 80,
    };
  }, [
    demoBypassTrafficJamPlus,
    demoApproachBannerOn,
    demoCloseHazardOn,
    guidanceRoute?.geometry,
    userAlongGuidanceM,
  ]);

  const driveApproachBannerPick = useMemo(() => {
    if (!hazardApproachAlertsActive) return null;
    if (demoApproachBannerImpact) {
      return {
        impact: demoApproachBannerImpact,
        phase: "near" as const,
      };
    }
    return pickDriveApproachBanner(
      routeImpactsForUi,
      driveApproachDismissedIds,
      earlyApproachMaxMetersForSpeed(speedMps)
    );
  }, [
    hazardApproachAlertsActive,
    demoApproachBannerImpact,
    routeImpactsForUi,
    driveApproachDismissedIds,
    speedMps,
  ]);

  useEffect(() => {
    setDriveApproachDismissedIds(new Set());
  }, [navigationStarted, guidanceRouteId]);

  return {
    driveApproachBannerPick,
    driveApproachDismissedIds,
    setDriveApproachDismissedIds,
    hazardApproachAlertsActive,
  };
}
