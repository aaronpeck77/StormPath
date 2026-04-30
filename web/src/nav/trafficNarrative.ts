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
      advisoryHeadline: "Road closed or blocked ahead",
      advisorySubtext:
        d >= 0.1 ? `~+${formatDelayMinutesForUi(d)} min vs free-flow` : "Detour may be required",
      showAdvisoryDelayRow: true,
      progressStartLine: `Blocked — +${formatDelayMinutesForUi(d)} min vs free-flow`,
      shouldAddCorridorAlert: true,
      mapTitle: "Closure on route",
      mapDetail: "Blocked or closed segment ahead on the corridor.",
      mapSeverity: 90,
    };
  }

  if (leg.nearStopFraction != null) {
    return {
      advisoryHeadline: "Slow / stopped traffic ahead",
      advisorySubtext: d >= 0.1 ? `+${formatDelayMinutesForUi(d)} min vs free-flow` : null,
      showAdvisoryDelayRow: d >= 0.1,
      progressStartLine: `Near-stopped — +${formatDelayMinutesForUi(d)} min`,
      shouldAddCorridorAlert: true,
      mapTitle: "Very slow on route",
      mapDetail: "Traffic nearly stopped in part of the corridor.",
      mapSeverity: 86,
    };
  }

  if (d < 0.05 && (c === "low" || c === "unknown")) {
    return {
      advisoryHeadline: "Clear — little delay",
      advisorySubtext: "Typical flow for this path",
      showAdvisoryDelayRow: false,
      progressStartLine: null,
      shouldAddCorridorAlert: false,
      mapTitle: "Little delay",
      mapDetail: "No notable delay vs free-flow baseline.",
      mapSeverity: 28,
    };
  }

  if (heavySegmentsButMildTotal) {
    const congHint = c === "severe" ? "Severe spots" : "Heavy spots";
    return {
      advisoryHeadline: "Patchy slowdowns — small overall delay",
      advisorySubtext: `+${formatDelayMinutesForUi(d)} min total. ${congHint} on the line.`,
      showAdvisoryDelayRow: true,
      progressStartLine: `+${formatDelayMinutesForUi(d)} min — ${c === "severe" ? "severe" : "heavy"} in places`,
      shouldAddCorridorAlert: d >= 0.08 || sig,
      mapTitle: `+${formatDelayMinutesForUi(d)} min — heavy stretches`,
      mapDetail: "Some segments very slow; whole-trip delay is still small.",
      mapSeverity: Math.min(78, 52 + d * 5),
    };
  }

  if (d < 1) {
    return {
      advisoryHeadline: d < 0.3 ? "Light delay" : "Mild delay",
      advisorySubtext: d >= 0.05 ? `+${formatDelayMinutesForUi(d)} min` : null,
      showAdvisoryDelayRow: d >= 0.05,
      progressStartLine: d >= 0.05 ? `+${formatDelayMinutesForUi(d)} min` : null,
      shouldAddCorridorAlert: sig || d >= 0.4,
      mapTitle: "Mild delay",
      mapDetail: `~+${formatDelayMinutesForUi(d)} min vs free-flow.`,
      mapSeverity: 54,
    };
  }

  if (d < 4) {
    return {
      advisoryHeadline: "Moderate delay",
      advisorySubtext: `+${formatDelayMinutesForUi(d)} min`,
      showAdvisoryDelayRow: true,
      progressStartLine: `+${formatDelayMinutesForUi(d)} min`,
      shouldAddCorridorAlert: true,
      mapTitle: "Moderate delay",
      mapDetail: `~+${formatDelayMinutesForUi(d)} min vs free-flow.`,
      mapSeverity: 64,
    };
  }

  if (d < 8) {
    return {
      advisoryHeadline: "Slower than usual",
      advisorySubtext: `+${formatDelayMinutesForUi(d)} min`,
      showAdvisoryDelayRow: true,
      progressStartLine: `+${formatDelayMinutesForUi(d)} min`,
      shouldAddCorridorAlert: true,
      mapTitle: "Noticeable delay",
      mapDetail: `~+${formatDelayMinutesForUi(d)} min on this leg.`,
      mapSeverity: 72,
    };
  }

  if (d < 15) {
    return {
      advisoryHeadline: "Heavy delay",
      advisorySubtext: `+${formatDelayMinutesForUi(d)} min`,
      showAdvisoryDelayRow: true,
      progressStartLine: `+${formatDelayMinutesForUi(d)} min — heavy`,
      shouldAddCorridorAlert: true,
      mapTitle: "Heavy delay",
      mapDetail: `~+${formatDelayMinutesForUi(d)} min vs free-flow.`,
      mapSeverity: 82,
    };
  }

  return {
    advisoryHeadline: "Major delay",
    advisorySubtext: `+${formatDelayMinutesForUi(d)} min`,
    showAdvisoryDelayRow: true,
    progressStartLine: `+${formatDelayMinutesForUi(d)} min — severe`,
    shouldAddCorridorAlert: true,
    mapTitle: "Severe delay",
    mapDetail: `Very long delay (~+${formatDelayMinutesForUi(d)} min).`,
    mapSeverity: 88,
  };
}
