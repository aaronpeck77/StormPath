import { useMemo } from "react";
import { useProgressRailFootInset } from "../hooks/useProgressRailFootInset";
import { routePickSlotHex } from "../ui/mapRouteStyle";
import { routeSlotIndexFor } from "../ui/mapRouteLayers";
import type { NavRoute } from "./types";
import type { TrafficBypassCompareState } from "../state/routeCompareStore";

export type UseProgressRailChromeDeps = {
  isPlus: boolean;
  advisoryLifeSafetyOn: boolean;
  trafficBypassCompare: TrafficBypassCompareState | null;
  progressRailRoute: NavRoute | undefined;
  guidanceRoute: NavRoute | undefined;
  orderedRouteIds: string[];
  navigationStarted: boolean;
  radarMapOverlayOn: boolean;
  radarFrameUtcSec: number | null;
};

/**
 * Small chrome-only derived flags that used to sit inline in `App.tsx`: whether the storm
 * advisory strip / vertical progress rail should render, the progress rail's route color,
 * and the radar frame time labels shown next to the radar toggle.
 */
export function useProgressRailChrome(deps: UseProgressRailChromeDeps) {
  const {
    isPlus,
    advisoryLifeSafetyOn,
    trafficBypassCompare,
    progressRailRoute,
    guidanceRoute,
    orderedRouteIds,
    navigationStarted,
    radarMapOverlayOn,
    radarFrameUtcSec,
  } = deps;

  /** Basic: status strip (forecast + offers). Plus: full storm advisory when enabled. */
  const showStormAdvisoryChrome = isPlus ? advisoryLifeSafetyOn : true;

  const showProgressRail =
    isPlus &&
    !trafficBypassCompare &&
    Boolean(progressRailRoute?.geometry && progressRailRoute.geometry.length >= 2);

  useProgressRailFootInset(showProgressRail);

  /** Matches map: planning uses A/B/C preview; after Go the active leg reads as primary blue. */
  const progressStripRouteColor = useMemo(() => {
    if (!guidanceRoute) return routePickSlotHex(0);
    if (navigationStarted) return routePickSlotHex(0);
    return routePickSlotHex(routeSlotIndexFor(guidanceRoute.id, orderedRouteIds));
  }, [guidanceRoute, orderedRouteIds, navigationStarted]);

  const radarFrameClockLabel = useMemo(() => {
    if (!radarMapOverlayOn || radarFrameUtcSec == null) return null;
    return new Date(radarFrameUtcSec * 1000).toLocaleString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }, [radarMapOverlayOn, radarFrameUtcSec]);

  const radarFrameTimeLabel = useMemo(() => {
    if (!radarFrameClockLabel) return null;
    return new Date(radarFrameUtcSec! * 1000).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }, [radarFrameClockLabel, radarFrameUtcSec]);

  return {
    showStormAdvisoryChrome,
    showProgressRail,
    progressStripRouteColor,
    radarFrameClockLabel,
    radarFrameTimeLabel,
  };
}
