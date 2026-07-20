import type { MapboxTrafficLeg } from "../services/mapboxDirectionsTraffic";
import { formatDurationMinutes } from "../ui/formatEta";
import { isSignificantTrafficDelay } from "./constants";

/**
 * True when Mapbox points at a concrete slowdown on the polyline — not route-wide delay vs typical.
 * Progress bar, map corridor, and advisory traffic only use this gate.
 */
export function hasLocalizedTrafficIssue(leg: MapboxTrafficLeg | null | undefined): boolean {
  if (!leg) return false;
  if (leg.hasClosure) return true;
  if ((leg.constructionCount ?? 0) > 0) return true;
  if (leg.nearStopFraction != null) return true;
  if (leg.firstHeavyCongestionFraction != null) return true;
  return false;
}

function gateTrafficSurfaces(
  narrative: UnifiedTrafficNarrative,
  leg: MapboxTrafficLeg | null | undefined
): UnifiedTrafficNarrative {
  if (hasLocalizedTrafficIssue(leg)) return narrative;
  return {
    ...narrative,
    shouldAddCorridorAlert: false,
    progressStartLine: null,
  };
}

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
  if (d < 0.05) return formatDurationMinutes(1);
  if (d < 1) return formatDurationMinutes(1);
  return formatDurationMinutes(d);
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
  /** Mapbox can label the corridor "severe" while whole-route delay is tiny — only use patchy-copy when delay is meaningful. */
  const heavySegmentsButMildTotal = (c === "heavy" || c === "severe") && d >= 1 && d < 5;

  if (!hasLive || !leg) {
    return gateTrafficSurfaces(
      {
        advisoryHeadline: "—",
        advisorySubtext: null,
        showAdvisoryDelayRow: false,
        progressStartLine: null,
        shouldAddCorridorAlert: false,
        mapTitle: "",
        mapDetail: "",
        mapSeverity: 0,
      },
      leg
    );
  }

  if (leg.hasClosure) {
    return gateTrafficSurfaces(
      {
        advisoryHeadline: "Road closed or blocked ahead",
        advisorySubtext:
          d >= 0.1 ? `~+${formatDelayMinutesForUi(d)} vs free-flow` : "Detour may be required",
        showAdvisoryDelayRow: true,
        progressStartLine: `Blocked — +${formatDelayMinutesForUi(d)} vs free-flow`,
        shouldAddCorridorAlert: true,
        mapTitle: "Closure on route",
        mapDetail: "Blocked or closed segment ahead on the corridor.",
        mapSeverity: 90,
      },
      leg
    );
  }

  if ((leg.constructionCount ?? 0) > 0) {
    const detail =
      leg.constructionSummary?.slice(0, 120) ||
      "Mapbox reports construction on this corridor — watch for workers and changed limits.";
    return gateTrafficSurfaces(
      {
        advisoryHeadline:
          leg.constructionCount > 1
            ? `Construction zones ahead (${leg.constructionCount})`
            : "Construction ahead",
        advisorySubtext: detail,
        showAdvisoryDelayRow: d >= 0.1,
        progressStartLine:
          d >= 0.1
            ? `Construction — +${formatDelayMinutesForUi(d)} vs free-flow`
            : "Construction on route",
        shouldAddCorridorAlert: true,
        mapTitle: "Construction on route",
        mapDetail: detail,
        mapSeverity: 70,
      },
      leg
    );
  }

  if (leg.nearStopFraction != null) {
    return gateTrafficSurfaces(
      {
        advisoryHeadline: "Slow / stopped traffic ahead",
        advisorySubtext: d >= 0.1 ? `+${formatDelayMinutesForUi(d)} vs free-flow` : null,
        showAdvisoryDelayRow: d >= 0.1,
        progressStartLine: `Near-stopped — +${formatDelayMinutesForUi(d)}`,
        shouldAddCorridorAlert: true,
        mapTitle: "Very slow on route",
        mapDetail: "Traffic nearly stopped in part of the corridor.",
        mapSeverity: 86,
      },
      leg
    );
  }

  if (d < 0.05 && (c === "low" || c === "unknown")) {
    return gateTrafficSurfaces(
      {
        advisoryHeadline: "Clear — little delay",
        advisorySubtext: "Typical flow for this path",
        showAdvisoryDelayRow: false,
        progressStartLine: null,
        shouldAddCorridorAlert: false,
        mapTitle: "Little delay",
        mapDetail: "No notable delay vs free-flow baseline.",
        mapSeverity: 28,
      },
      leg
    );
  }

  if (heavySegmentsButMildTotal) {
    const congHint = c === "severe" ? "Severe spots" : "Heavy spots";
    const delayBit = formatDelayMinutesForUi(d);
    const hasSegmentAnchor =
      leg.nearStopFraction != null || leg.firstHeavyCongestionFraction != null;
    return gateTrafficSurfaces(
      {
        advisoryHeadline: "Patchy slowdowns — small overall delay",
        advisorySubtext: `+${delayBit} vs free-flow (whole route). ${congHint} on the line.`,
        showAdvisoryDelayRow: true,
        /* One factual line: delay + segment tone; avoid duplicating "severe" vs "small delay" in two places. */
        progressStartLine: `+${delayBit} — patchy congestion`,
        /* Avoid a map “jam ahead” pin when we only have route-wide delay + summary, no segment anchor. */
        shouldAddCorridorAlert: (d >= 0.08 || sig) && (hasSegmentAnchor || d >= 5),
        /* Short label if shown without headline; corridor UI uses advisoryHeadline for the title. */
        mapTitle: `Heavy traffic in places (~+${delayBit} vs free-flow)`,
        mapDetail: "Some segments are very congested; extra time on the whole trip is still small.",
        mapSeverity: Math.min(78, 52 + d * 5),
      },
      leg
    );
  }

  if (d < 1) {
    return gateTrafficSurfaces(
      {
        advisoryHeadline: d < 0.3 ? "Light delay" : "Mild delay",
        advisorySubtext: d >= 0.05 ? `+${formatDelayMinutesForUi(d)}` : null,
        showAdvisoryDelayRow: d >= 0.05,
        progressStartLine: d >= 0.05 ? `+${formatDelayMinutesForUi(d)}` : null,
        shouldAddCorridorAlert: sig || d >= 0.4,
        mapTitle: "Mild delay",
        mapDetail: `~+${formatDelayMinutesForUi(d)} vs free-flow.`,
        mapSeverity: 54,
      },
      leg
    );
  }

  if (d < 4) {
    return gateTrafficSurfaces(
      {
        advisoryHeadline: "Moderate delay",
        advisorySubtext: `+${formatDelayMinutesForUi(d)}`,
        showAdvisoryDelayRow: true,
        progressStartLine: `+${formatDelayMinutesForUi(d)}`,
        shouldAddCorridorAlert: true,
        mapTitle: "Moderate delay",
        mapDetail: `~+${formatDelayMinutesForUi(d)} vs free-flow.`,
        mapSeverity: 64,
      },
      leg
    );
  }

  if (d < 8) {
    return gateTrafficSurfaces(
      {
        advisoryHeadline: "Slower than usual",
        advisorySubtext: `+${formatDelayMinutesForUi(d)}`,
        showAdvisoryDelayRow: true,
        progressStartLine: `+${formatDelayMinutesForUi(d)}`,
        shouldAddCorridorAlert: true,
        mapTitle: "Noticeable delay",
        mapDetail: `~+${formatDelayMinutesForUi(d)} on this leg.`,
        mapSeverity: 72,
      },
      leg
    );
  }

  if (d < 15) {
    return gateTrafficSurfaces(
      {
        advisoryHeadline: "Heavy delay",
        advisorySubtext: `+${formatDelayMinutesForUi(d)}`,
        showAdvisoryDelayRow: true,
        progressStartLine: `+${formatDelayMinutesForUi(d)} — heavy`,
        shouldAddCorridorAlert: true,
        mapTitle: "Heavy delay",
        mapDetail: `~+${formatDelayMinutesForUi(d)} vs free-flow.`,
        mapSeverity: 82,
      },
      leg
    );
  }

  return gateTrafficSurfaces(
    {
      advisoryHeadline: "Major delay",
      advisorySubtext: `+${formatDelayMinutesForUi(d)}`,
      showAdvisoryDelayRow: true,
      progressStartLine: `+${formatDelayMinutesForUi(d)} — severe`,
      shouldAddCorridorAlert: true,
      mapTitle: "Severe delay",
      mapDetail: `Very long delay (~+${formatDelayMinutesForUi(d)}).`,
      mapSeverity: 88,
    },
    leg
  );
}
