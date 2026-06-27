import { useEffect, useRef, type MutableRefObject } from "react";
import type { LngLat, NavRoute } from "../nav/types";
import type { TrafficOverlay } from "../situation/fusedSnapshot";
import {
  auditTripNavDisplay,
  computeRemainingDistanceMeters,
  computeRemainingDriveEtaMinutes,
  repairActionsForIssues,
  TRIP_NAV_DISPLAY_POLL_MS,
  TRIP_NAV_DISPLAY_REPAIR_COOLDOWN_MS,
} from "./tripNavDisplay";
import { reportAppHealthRepair } from "../monitoring/appHealthSignals";
import type { ScoredRoute } from "../scoring/scoreRoutes";

export type UseTripNavDisplayHealthDeps = {
  navigationStarted: boolean;
  appForeground: boolean;
  lineFocusId: string;
  guidanceRouteId: string;
  planRoutes: NavRoute[];
  scored: ScoredRoute[];
  alongHoldResetKey: number;
  guidanceRouteLengthMRef: MutableRefObject<number>;
  userAlongGuidanceMRef: MutableRefObject<number>;
  guidanceRouteGeomRef: MutableRefObject<LngLat[] | null>;
  speedMpsRef: MutableRefObject<number | null>;
  trafficOverlayRef: MutableRefObject<TrafficOverlay | undefined>;
  setAlongHoldResetKey: (updater: (prev: number) => number) => void;
  bumpTrafficRefresh: () => void;
};

export function useTripNavDisplayHealth(deps: UseTripNavDisplayHealthDeps): void {
  const {
    navigationStarted,
    appForeground,
    lineFocusId,
    guidanceRouteId,
    planRoutes,
    scored,
    alongHoldResetKey,
    guidanceRouteLengthMRef,
    userAlongGuidanceMRef,
    guidanceRouteGeomRef,
    speedMpsRef,
    trafficOverlayRef,
    setAlongHoldResetKey,
    bumpTrafficRefresh,
  } = deps;

  const tripNavRepairAtRef = useRef(0);
  const alongProgressTrackRef = useRef({ alongM: 0, atMs: 0 });

  useEffect(() => {
    alongProgressTrackRef.current = { alongM: 0, atMs: 0 };
  }, [alongHoldResetKey, guidanceRouteId]);

  useEffect(() => {
    if (!navigationStarted || !appForeground) return;
    const runAudit = () => {
      const routeLengthM = guidanceRouteLengthMRef.current;
      const alongM = userAlongGuidanceMRef.current;
      if (routeLengthM <= 1) return;

      const speed = speedMpsRef.current;
      const now = Date.now();
      const track = alongProgressTrackRef.current;
      if (speed != null && speed >= 2.5) {
        if (Math.abs(alongM - track.alongM) >= 25) {
          alongProgressTrackRef.current = { alongM, atMs: now };
        }
      } else {
        alongProgressTrackRef.current = { alongM, atMs: now };
      }
      const alongStaleMs =
        speed != null && speed >= 2.5 ? now - alongProgressTrackRef.current.atMs : 0;

      const focusId = lineFocusId;
      const s = scored.find((x) => x.route.id === focusId);
      const route = planRoutes.find((r) => r.id === focusId);
      const fullEta = s
        ? Math.round(s.effectiveEtaMinutes)
        : route
          ? Math.round(route.baseEtaMinutes)
          : null;
      const remainingDistanceM = computeRemainingDistanceMeters(true, routeLengthM, alongM);
      const trafficLeg = trafficOverlayRef.current?.[focusId] ?? null;
      const liveRemaining =
        trafficLeg?.mapboxDurationMinutes != null &&
        Number.isFinite(trafficLeg.mapboxDurationMinutes)
          ? trafficLeg.mapboxDurationMinutes
          : null;
      const remainingEtaMinutes = computeRemainingDriveEtaMinutes({
        navigationStarted: true,
        fullEtaMinutes: fullEta,
        routeLengthM,
        alongM,
        hasRouteGeometry: Boolean(guidanceRouteGeomRef.current?.length),
        liveRemainingEtaMinutes: liveRemaining,
      });

      const audit = auditTripNavDisplay({
        navigationStarted: true,
        routeLengthM,
        alongM,
        fullEtaMinutes: fullEta,
        remainingEtaMinutes,
        remainingDistanceM,
        speedMps: speed,
        alongStaleMs,
      });

      if (audit.ok) return;
      if (now - tripNavRepairAtRef.current < TRIP_NAV_DISPLAY_REPAIR_COOLDOWN_MS) return;
      tripNavRepairAtRef.current = now;
      const actions = repairActionsForIssues(audit.issues);
      for (const action of actions) {
        if (action === "reset_along_hold") setAlongHoldResetKey((k) => k + 1);
        if (action === "refresh_traffic") bumpTrafficRefresh();
      }
      reportAppHealthRepair("nav_display", audit.issues, actions);
      if (import.meta.env.DEV) {
        console.info("[nav-health] trip display repair", audit.issues);
      }
    };

    runAudit();
    const id = window.setInterval(runAudit, TRIP_NAV_DISPLAY_POLL_MS);
    return () => window.clearInterval(id);
  }, [
    navigationStarted,
    appForeground,
    lineFocusId,
    guidanceRouteId,
    planRoutes,
    scored,
    bumpTrafficRefresh,
  ]);
}
