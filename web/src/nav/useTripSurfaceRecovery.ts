import { useEffect, useRef, type MutableRefObject } from "react";
import { reportAppHealthRepair } from "../monitoring/appHealthSignals";
import type { NavRoute } from "./types";
import {
  auditTripSurface,
  repairActionsForTripSurfaceIssues,
  TRIP_SURFACE_FOREGROUND_DEBOUNCE_MS,
  TRIP_SURFACE_POLL_MS,
  TRIP_SURFACE_REPAIR_COOLDOWN_MS,
  type TripSurfaceRepairAction,
} from "./tripSurfaceHealth";

export type UseTripSurfaceRecoveryDeps = {
  appForeground: boolean;
  hasActiveTrip: boolean;
  navigationStarted: boolean;
  orderedRouteIds: string[];
  planRoutes: NavRoute[];
  guidanceRouteId: string;
  routingInFlightRef: MutableRefObject<boolean>;
  /** Primary directions fetch — separate from alt-route refresh. */
  routingRef?: MutableRefObject<boolean>;
  setFitTrigger: (updater: (n: number) => number) => void;
  setAlongHoldResetKey: (updater: (n: number) => number) => void;
  bumpTrafficRefresh: () => void;
  bumpRouteForecastRefresh: () => void;
  /** When false (drive nav), skip auto corridor forecast repairs. */
  advisoryForecastRepairEnabled?: boolean;
  /** Optional — brief user hint when auto-repair runs (not on silent poll ticks). */
  onAutoRepair?: (actions: TripSurfaceRepairAction[]) => void;
};

export function useTripSurfaceRecovery(deps: UseTripSurfaceRecoveryDeps): void {
  const {
    appForeground,
    hasActiveTrip,
    navigationStarted,
    orderedRouteIds,
    planRoutes,
    guidanceRouteId,
    routingInFlightRef,
    routingRef,
    setFitTrigger,
    setAlongHoldResetKey,
    bumpTrafficRefresh,
    bumpRouteForecastRefresh,
    advisoryForecastRepairEnabled = true,
    onAutoRepair,
  } = deps;

  const lastRepairAtRef = useRef(0);
  const foregroundDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasForegroundRef = useRef(appForeground);

  const runRepair = (foregroundResume: boolean, notifyUser: boolean) => {
    if (!hasActiveTrip || routingInFlightRef.current || routingRef?.current) return;

    const audit = auditTripSurface({
      orderedRouteIds,
      planRoutes,
      navigationStarted,
      guidanceRouteId,
      foregroundResume,
    });
    if (audit.ok) return;

    const now = Date.now();
    if (now - lastRepairAtRef.current < TRIP_SURFACE_REPAIR_COOLDOWN_MS) return;
    lastRepairAtRef.current = now;

    const actions = repairActionsForTripSurfaceIssues(audit.issues);
    if (!actions.length) return;

    for (const action of actions) {
      if (action === "bump_map_fit") setFitTrigger((n) => n + 1);
      if (action === "reset_along_hold") setAlongHoldResetKey((k) => k + 1);
      if (action === "refresh_traffic") bumpTrafficRefresh();
      if (action === "refresh_forecast" && advisoryForecastRepairEnabled) {
        bumpRouteForecastRefresh();
      }
    }

    reportAppHealthRepair("trip_surface", audit.issues, actions);
    if (notifyUser) onAutoRepair?.(actions);
    if (import.meta.env.DEV) {
      console.info("[trip-surface] auto-repair", audit.issues, actions);
    }
  };

  useEffect(() => {
    if (!hasActiveTrip || !appForeground) return;
    runRepair(false, false);
    const id = window.setInterval(() => runRepair(false, false), TRIP_SURFACE_POLL_MS);
    return () => window.clearInterval(id);
  }, [
    hasActiveTrip,
    appForeground,
    navigationStarted,
    orderedRouteIds.join("|"),
    guidanceRouteId,
    planRoutes,
  ]);

  useEffect(() => {
    const wasForeground = wasForegroundRef.current;
    wasForegroundRef.current = appForeground;

    if (foregroundDebounceRef.current != null) {
      window.clearTimeout(foregroundDebounceRef.current);
      foregroundDebounceRef.current = null;
    }

    if (!hasActiveTrip || !appForeground || wasForeground) return;

    foregroundDebounceRef.current = window.setTimeout(() => {
      foregroundDebounceRef.current = null;
      runRepair(true, true);
    }, TRIP_SURFACE_FOREGROUND_DEBOUNCE_MS);

    return () => {
      if (foregroundDebounceRef.current != null) {
        window.clearTimeout(foregroundDebounceRef.current);
        foregroundDebounceRef.current = null;
      }
    };
  }, [appForeground, hasActiveTrip, navigationStarted, orderedRouteIds.join("|"), guidanceRouteId]);
}
