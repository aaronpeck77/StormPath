import type { MapboxTrafficLeg } from "../services/mapboxDirectionsTraffic";
import { isSignificantTrafficDelay } from "./constants";

/**
 * One place for traffic copy + strip severity so advisory, route progress, and map/strip agree.
 * Mapbox `congestionSummary` is segment-based and can read "heavy" while route-wide delay is only
 * a few minutes — we always pair it with `delayVsTypicalMinutes` for user-facing labels.
 */
export type UnifiedTrafficNarrative = {
  /** Main bold line in Road impacts & traffic */
  advisoryHeadline: string;
  /** Optional second line (delay / context) */
  advisorySubtext: string | null;
  showAdvisoryDelayRow: boolean;
  /** Shown on the start / whole-route progress chunk (road line) */
  progressStartLine: string | null;
  /** Add the traffic corridor card to the map + strip */
  shouldAddCorridorAlert: boolean;
  mapTitle: string;
  mapDetail: string;
  mapSeverity: number;
};

export function formatDelayMinutesForUi(delayMin: number): string {
  const d = Math.max(0, delayMin);
  if (d < 0.05) return "under 1";
  if (d < 0.95) return "under 1";
  if (d < 10) return d < 2 ? d.toFixed(1).replace(/\.0$/, "") : String(Math.round(d));
  return String(Math.round(d));
}

export function unifiedTrafficNarrative(
  delayMin: number,
  leg: MapboxTrafficLeg | null | undefined,
  hasLive: boolean,
  remainingTripMin: number | null | undefined
): UnifiedTrafficNarrative {
  const d = Math.max(0, delayMin);
  const c = leg?.congestionSummary ?? "unknown";
  const rem = remainingTripMin;
  const sig = isSignificantTrafficDelay(d, rem);
  const heavySegmentsButMildTotal = (c === "heavy" || c === "severe") && d < 5;

  if (!hasLive || !leg) {
    return {
      advisoryHeadline: "—",
      advisorySubtext: null,
      showAdvisoryDelayRow: false,
      progressStartLine: null,
      shouldAddCorridorAlert: false,
      mapTitle: "",
      mapDetail: "",
      mapSeverity: 0,
    };
  }

  if (leg.hasClosure) {
    return {
      advisoryHeadline: "Closure or blocked segment on route",
      advisorySubtext:
        d >= 0.1
          ? `About +${formatDelayMinutesForUi(d)} min vs free-flow (if passable)`
          : "Detour or alternate may be required — check the map",
      showAdvisoryDelayRow: true,
      progressStartLine: `Closure / blocked — +${formatDelayMinutesForUi(d)} min vs free-flow (Mapbox)`,
      shouldAddCorridorAlert: true,
      mapTitle: "Closure on route",
      mapDetail: "Live traffic data indicates a closure or blocked segment ahead.",
      mapSeverity: 90,
    };
  }

  if (leg.nearStopFraction != null) {
    return {
      advisoryHeadline: "Near-stopped traffic in the corridor",
      advisorySubtext: d >= 0.1 ? `+${formatDelayMinutesForUi(d)} min vs free-flow, route-wide` : null,
      showAdvisoryDelayRow: d >= 0.1,
      progressStartLine: `Near-stopped in places — +${formatDelayMinutesForUi(d)} min vs free-flow`,
      shouldAddCorridorAlert: true,
      mapTitle: "Very slow traffic on route",
      mapDetail: "Live traffic samples show near-stopped flow in this corridor.",
      mapSeverity: 86,
    };
  }

  if (d < 0.05 && (c === "low" || c === "unknown")) {
    return {
      advisoryHeadline: "No meaningful delay vs free-flow",
      advisorySubtext: "Moving for typical conditions on this shape",
      showAdvisoryDelayRow: false,
      progressStartLine: null,
      shouldAddCorridorAlert: false,
      mapTitle: "No meaningful delay on route",
      mapDetail: "No notable delay compared to the free-flow baseline for this path.",
      mapSeverity: 28,
    };
  }

  if (heavySegmentsButMildTotal) {
    const congHint =
      c === "severe" ? "Mapbox: severe congestion in some segments" : "Mapbox: heavy congestion in some segments";
    return {
      advisoryHeadline: "Slower in some spots — small route-wide cost",
      advisorySubtext: `+${formatDelayMinutesForUi(d)} min total vs free-flow. ${congHint}.`,
      showAdvisoryDelayRow: true,
      progressStartLine: `+${formatDelayMinutesForUi(d)} min vs free-flow — ${c === "severe" ? "severe" : "heavy"} congestion in places (not whole trip)`,
      shouldAddCorridorAlert: d >= 0.08 || sig,
      mapTitle: `${formatDelayMinutesForUi(d)} min added — heavy spots on corridor`,
      mapDetail:
        "Route-wide delay is modest, but live traffic data shows very slow or stopped segments in places — watch the map.",
      mapSeverity: Math.min(78, 52 + d * 5),
    };
  }

  if (d < 1) {
    return {
      advisoryHeadline: d < 0.3 ? "Light / minimal delay" : "Mild delay vs free-flow",
      advisorySubtext: d >= 0.05 ? `+${formatDelayMinutesForUi(d)} min` : null,
      showAdvisoryDelayRow: d >= 0.05,
      progressStartLine: d >= 0.05 ? `+${formatDelayMinutesForUi(d)} min vs free-flow` : null,
      shouldAddCorridorAlert: sig || d >= 0.4,
      mapTitle: "Mild traffic delay on route",
      mapDetail: `About +${formatDelayMinutesForUi(d)} min longer than the free-flow baseline for this path.`,
      mapSeverity: 54,
    };
  }

  if (d < 4) {
    return {
      advisoryHeadline: "Moderate delay vs free-flow",
      advisorySubtext: `+${formatDelayMinutesForUi(d)} min`,
      showAdvisoryDelayRow: true,
      progressStartLine: `+${formatDelayMinutesForUi(d)} min vs free-flow`,
      shouldAddCorridorAlert: true,
      mapTitle: "Moderate traffic delay on route",
      mapDetail: `About +${formatDelayMinutesForUi(d)} min longer than the free-flow baseline for this path.`,
      mapSeverity: 64,
    };
  }

  if (d < 8) {
    return {
      advisoryHeadline: "Slower than typical on this route",
      advisorySubtext: `+${formatDelayMinutesForUi(d)} min vs free-flow — noticeable delay`,
      showAdvisoryDelayRow: true,
      progressStartLine: `+${formatDelayMinutesForUi(d)} min vs free-flow`,
      shouldAddCorridorAlert: true,
      mapTitle: "Slower than typical (traffic delay)",
      mapDetail: `About +${formatDelayMinutesForUi(d)} min of delay on this trip vs free-flow conditions.`,
      mapSeverity: 72,
    };
  }

  if (d < 15) {
    return {
      advisoryHeadline: "Heavy delay on route",
      advisorySubtext: `+${formatDelayMinutesForUi(d)} min vs free-flow`,
      showAdvisoryDelayRow: true,
      progressStartLine: `+${formatDelayMinutesForUi(d)} min vs free-flow — heavy`,
      shouldAddCorridorAlert: true,
      mapTitle: "Heavy traffic delay on route",
      mapDetail: `Substantial delay: about +${formatDelayMinutesForUi(d)} min vs free-flow baseline.`,
      mapSeverity: 82,
    };
  }

  return {
    advisoryHeadline: "Severe / very heavy delay on route",
    advisorySubtext: `+${formatDelayMinutesForUi(d)} min vs free-flow`,
    showAdvisoryDelayRow: true,
    progressStartLine: `+${formatDelayMinutesForUi(d)} min vs free-flow — very heavy`,
    shouldAddCorridorAlert: true,
    mapTitle: "Severe traffic delay on route",
    mapDetail: `Very long delay: about +${formatDelayMinutesForUi(d)} min compared to the free-flow baseline for this path.`,
    mapSeverity: 88,
  };
}
