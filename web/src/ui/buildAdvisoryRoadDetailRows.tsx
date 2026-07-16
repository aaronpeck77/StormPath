import type { ReactNode } from "react";
import type { RouteAlert } from "../nav/routeAlerts";
import type { StormRoadDetailRow } from "./StormAdvisoryBar";

type TrafficLegLike = {
  nearStopFraction?: number | null;
  hasClosure?: boolean;
} | null | undefined;

/**
 * Compact ROADS rows for the advisory bar: traffic stop + incident-like alerts.
 */
export function buildAdvisoryRoadDetailRows(input: {
  guidanceRouteId: string;
  trafficOverlay: Record<string, TrafficLegLike> | null | undefined;
  routeAlerts: RouteAlert[];
  onInspectTrafficStop: () => void;
}): StormRoadDetailRow[] {
  const rows: StormRoadDetailRow[] = [];
  const tLeg = input.trafficOverlay?.[input.guidanceRouteId];
  const hasTrafficStop = Boolean(tLeg?.nearStopFraction != null || tLeg?.hasClosure);
  const incidentLikeAlert = input.routeAlerts.find((a) => {
    if (a.corridorKind === "traffic" && a.id !== "traffic-delay") return true;
    if (a.corridorKind !== "hazard") return false;
    return /\b(accident|crash|incident|closure|closed|blocked|lane\s*closure|work\s*zone|construction)\b/i.test(
      `${a.title} ${a.detail}`
    );
  });

  if (hasTrafficStop) {
    rows.push({
      label: "Traffic stop",
      text: (<strong>Stopped/blocked traffic detected on your route</strong>) as ReactNode,
      actionLabel: "Show stop",
      onAction: input.onInspectTrafficStop,
    });
  }
  if (incidentLikeAlert) {
    const headline = (incidentLikeAlert.detail || incidentLikeAlert.title || "").trim();
    if (headline) {
      rows.push({
        label: "Traffic alert",
        text: (
          <>
            <strong>{headline}</strong>{" "}
            <span className="storm-advisory-bar__road-muted">Possible slowdown on route.</span>
          </>
        ) as ReactNode,
      });
    }
  }

  return rows;
}
