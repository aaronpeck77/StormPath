import { useCallback } from "react";
import type { getWebEnv } from "../config/env";
import type { NavRoute } from "../nav/types";
import type { MapViewMode } from "../ui/driveMapTypes";
import type { RouteAheadStormBand } from "../nav/routeAheadSync";
import type { RouteHazardSheetState } from "../state/uiStore";
import { routeAlertForNwsAdvisoryClick } from "../weatherAlerts/nwsAsRouteAlerts";
import type { NormalizedWeatherAlert } from "../weatherAlerts/types";
import { stormpathVersionLabel } from "../appVersion";
import type { LngLat } from "../nav/types";

export interface UseAdvisoryInteractionsDeps {
  env: ReturnType<typeof getWebEnv>;
  viewMode: MapViewMode;
  navigationStarted: boolean;
  destLngLat: LngLat | null;
  lineFocusId: string;
  guidanceRoute: NavRoute | undefined;
  advisoryStormStripBands: RouteAheadStormBand[];
  setRouteHazardSheet: (next: RouteHazardSheetState) => void;
}

export interface UseAdvisoryInteractionsResult {
  handleQuickReportIssue: () => void;
  handleAdvisoryNwsClick: (alert: NormalizedWeatherAlert) => void;
}

/** Support "quick report" mailto + tap-through from an NWS advisory chip to its route hazard sheet. */
export function useAdvisoryInteractions(
  deps: UseAdvisoryInteractionsDeps
): UseAdvisoryInteractionsResult {
  const {
    env,
    viewMode,
    navigationStarted,
    destLngLat,
    lineFocusId,
    guidanceRoute,
    advisoryStormStripBands,
    setRouteHazardSheet,
  } = deps;

  const handleQuickReportIssue = useCallback(() => {
    const to = env.supportEmail?.trim();
    if (!to) {
      const site = env.supportUrl?.trim();
      if (site) window.open(site, "_blank", "noopener,noreferrer");
      return;
    }
    const versionLabel = stormpathVersionLabel();
    const subject = encodeURIComponent(`StormPath quick issue report (${versionLabel})`);
    const quickDiag = [
      `App: StormPath ${versionLabel}`,
      `Online: ${typeof navigator === "undefined" ? "unknown" : navigator.onLine ? "yes" : "no"}`,
      `View: ${viewMode}`,
      `Navigating: ${navigationStarted ? "yes" : "no"}`,
      `Destination set: ${destLngLat ? "yes" : "no"}`,
    ].join("\n");
    const body = encodeURIComponent(
      `Describe what happened:\n\nExpected:\n\nWhat you were doing (route/area/time):\n\nQuick diagnostics:\n${quickDiag}\n`
    );
    window.location.href = `mailto:${to}?subject=${subject}&body=${body}`;
  }, [env.supportEmail, env.supportUrl, viewMode, navigationStarted, destLngLat]);

  const handleAdvisoryNwsClick = useCallback(
    (alert: NormalizedWeatherAlert) => {
      if (!lineFocusId) return;
      const geom = guidanceRoute?.geometry;
      if (!geom?.length) return;
      const band = advisoryStormStripBands.find((b) => b.alertId === alert.id);
      const routeAlert = routeAlertForNwsAdvisoryClick(alert, geom, band ?? null);
      if (!routeAlert) return;
      setRouteHazardSheet({
        routeId: lineFocusId,
        alerts: [routeAlert],
      });
    },
    [guidanceRoute?.geometry, lineFocusId, advisoryStormStripBands, setRouteHazardSheet]
  );

  return { handleQuickReportIssue, handleAdvisoryNwsClick };
}
