import { useEffect, useRef, type MutableRefObject } from "react";
import type { TrafficOverlay } from "../situation/fusedSnapshot";
import {
  auditLiveTrafficHealth,
  repairActionsForLiveTrafficIssues,
  LIVE_TRAFFIC_STALE_MS,
} from "./liveTrafficHealth";
import { reportAppHealthRepair } from "../monitoring/appHealthSignals";

const POLL_MS = 30_000;
/** Separate from the normal traffic poll interval — only forces an extra fetch when stuck. */
const REPAIR_COOLDOWN_MS = 3 * 60 * 1000;

export type UseLiveTrafficHealthDeps = {
  navigationStarted: boolean;
  appForeground: boolean;
  isPlus: boolean;
  isOnline: boolean;
  settingTrafficEnabled: boolean;
  hasMapboxToken: boolean;
  guidanceRouteId: string;
  trafficOverlay: TrafficOverlay | undefined;
  speedMpsRef: MutableRefObject<number | null>;
  bumpTrafficRefresh: () => void;
};

/**
 * Background watchdog + self-heal for the live Mapbox traffic / construction / closure pipeline.
 * A wrong query param or field name (like the `overview=false` bug that silenced construction
 * data) doesn't throw — ETA still updates from `duration`, so nothing visibly errors. This checks
 * that the active route has produced at least one real traffic leg recently while driving, and
 * forces an extra fetch if not.
 */
export function useLiveTrafficHealth(deps: UseLiveTrafficHealthDeps): void {
  const {
    navigationStarted,
    appForeground,
    isPlus,
    isOnline,
    settingTrafficEnabled,
    hasMapboxToken,
    guidanceRouteId,
    trafficOverlay,
    speedMpsRef,
    bumpTrafficRefresh,
  } = deps;

  const lastSuccessAtRef = useRef<number | null>(null);
  const hasEverSucceededRef = useRef(false);
  const lastRepairAtRef = useRef(0);
  const lastRouteIdRef = useRef(guidanceRouteId);

  useEffect(() => {
    if (lastRouteIdRef.current !== guidanceRouteId) {
      lastRouteIdRef.current = guidanceRouteId;
      lastSuccessAtRef.current = null;
      hasEverSucceededRef.current = false;
    }
    const leg = guidanceRouteId ? trafficOverlay?.[guidanceRouteId] : null;
    if (leg && typeof leg.mapboxDurationMinutes === "number" && Number.isFinite(leg.mapboxDurationMinutes)) {
      lastSuccessAtRef.current = Date.now();
      hasEverSucceededRef.current = true;
    }
  }, [guidanceRouteId, trafficOverlay]);

  useEffect(() => {
    if (!navigationStarted || !appForeground) return;
    const trafficEligible = isPlus && isOnline && settingTrafficEnabled && hasMapboxToken;

    const tick = () => {
      const now = Date.now();
      const msSinceLastSuccess =
        lastSuccessAtRef.current != null ? now - lastSuccessAtRef.current : null;
      const audit = auditLiveTrafficHealth({
        navigationStarted: true,
        trafficEligible,
        hasEverSucceeded: hasEverSucceededRef.current,
        msSinceLastSuccess,
        speedMps: speedMpsRef.current,
      });
      if (audit.ok) return;
      if (now - lastRepairAtRef.current < REPAIR_COOLDOWN_MS) return;
      lastRepairAtRef.current = now;

      const actions = repairActionsForLiveTrafficIssues(audit.issues);
      if (actions.includes("refresh_traffic")) bumpTrafficRefresh();
      reportAppHealthRepair("live_traffic", audit.issues, actions);
      if (import.meta.env.DEV) {
        console.info(
          "[live-traffic-health] no usable traffic leg for",
          msSinceLastSuccess ?? LIVE_TRAFFIC_STALE_MS,
          "ms — forcing refresh"
        );
      }
    };

    const id = window.setInterval(tick, POLL_MS);
    return () => window.clearInterval(id);
  }, [
    navigationStarted,
    appForeground,
    isPlus,
    isOnline,
    settingTrafficEnabled,
    hasMapboxToken,
    speedMpsRef,
    bumpTrafficRefresh,
  ]);
}
