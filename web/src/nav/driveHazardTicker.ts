import type { TimelineItem } from "./routeAheadSync";
import { timelineItemShowsOnRouteGraph } from "./routeAheadSync";
import { timelineItemBandColor } from "./timelineBandColors";
import { formatRouteAlertTiming, fmtMin } from "./routeAlertTiming";
import type { MapViewMode } from "../ui/driveMapTypes";

export type DriveHazardTickerInput = {
  items: readonly TimelineItem[];
  isPlus: boolean;
  isOnline: boolean;
  navigationStarted: boolean;
  viewMode: MapViewMode;
  userAlongMeters: number;
  metersToManeuver: number | null;
  miles: boolean;
  offRoute?: boolean;
};

const SEVERITY = { info: 0, caution: 1, serious: 2, avoid: 3 };

function collectHazardCandidates(
  input: DriveHazardTickerInput,
  nowMs: number,
  opts?: { pageGraph?: boolean; anyNavView?: boolean }
): TimelineItem[] {
  const { userAlongMeters: along, metersToManeuver: turnM } = input;
  if (!input.isPlus || !input.isOnline || !input.navigationStarted || input.offRoute ||
    (input.viewMode !== "drive" && !opts?.anyNavView) ||
    !Number.isFinite(along) || along < 0 || turnM == null || !Number.isFinite(turnM) || turnM <= 1609.34) return [];

  const candidates = input.items.filter((item) => {
    if (item.crossesRoute === false || item.coarsePreview || !item.label.trim() || !Number.isFinite(item.startMeters) ||
      !Number.isFinite(item.endMeters) || item.startMeters < 0 || item.endMeters < item.startMeters ||
      item.endMeters <= along) return false;
    if (opts?.pageGraph) {
      // Countdown set = whatever the route-info graph / advisory hazards feed shows.
      if (!timelineItemShowsOnRouteGraph(item)) return false;
    } else if (item.stripMuted || item.etaStale || item.severity === "info") return false;
    if (item.expiresIso) {
      const expiry = Date.parse(item.expiresIso);
      if (!Number.isFinite(expiry) || expiry <= nowMs) return false;
    }
    return true;
  });
  candidates.sort((a, b) => Math.max(0, a.startMeters - along) - Math.max(0, b.startMeters - along) ||
    SEVERITY[b.severity] - SEVERITY[a.severity] || a.id.localeCompare(b.id));
  return candidates;
}

function hazardDistanceLabel(item: TimelineItem, along: number, miles: boolean): string {
  const ahead = Math.max(0, item.startMeters - along);
  const distance = ahead / (miles ? 1609.34 : 1000);
  const unit = miles ? "mi" : "km";
  return ahead === 0
    ? item.developingLater ? "Possible here" : "Here now"
    : `${distance < 0.1 ? "<0.1" : distance < 10 ? distance.toFixed(1) : Math.round(distance)} ${unit}`;
}

function hazardLabel(item: TimelineItem): string {
  return `${item.developingLater ? "Possible: " : ""}${item.label.trim()}`;
}

export function selectDriveHazardTicker(input: DriveHazardTickerInput, nowMs = Date.now()) {
  const item = collectHazardCandidates(input, nowMs)[0];
  if (!item) return null;
  return {
    id: item.id,
    label: hazardLabel(item),
    distanceLabel: hazardDistanceLabel(item, input.userAlongMeters, input.miles),
    color: timelineItemBandColor(item),
  };
}

/** Queue variant for the iPad landscape hazard panel: next two hazards with ETA. */
export type DriveHazardQueueInput = DriveHazardTickerInput & {
  totalMeters?: number | null;
  planEtaMinutes?: number | null;
  driveEtaMinutes?: number | null;
};

/**
 * Next hazard the countdown will report — same candidate set as the queue.
 * Used to highlight the matching row on the route-info / advisory pages and
 * to drop a synced beacon on the route line.
 */
export function selectNextDriveHazardItem(
  input: DriveHazardQueueInput,
  opts?: { nowMs?: number; anyNavView?: boolean }
): TimelineItem | null {
  return collectHazardCandidates(input, opts?.nowMs ?? Date.now(), {
    pageGraph: true,
    anyNavView: opts?.anyNavView,
  })[0] ?? null;
}

export type DriveHazardQueueRow = {
  id: string;
  label: string;
  distanceLabel: string;
  etaLabel: string | null;
  color: string;
};

export function selectDriveHazardQueue(
  input: DriveHazardQueueInput,
  nowMs = Date.now()
): DriveHazardQueueRow[] {
  const along = input.userAlongMeters;
  return collectHazardCandidates(input, nowMs, { pageGraph: true }).slice(0, 2).map((item) => {
    const timing = formatRouteAlertTiming({
      startMeters: item.startMeters,
      endMeters: item.endMeters,
      userAlongMeters: along,
      totalMeters: input.totalMeters ?? 0,
      planEtaMinutes: input.planEtaMinutes ?? null,
      driveEtaMinutes: input.driveEtaMinutes ?? null,
      expiresIso: item.expiresIso ?? null,
      onsetIso: null,
      crossesRoute: item.crossesRoute !== false,
      placePhrase: item.placePhrase ?? null,
    });
    return {
      id: item.id,
      label: hazardLabel(item),
      distanceLabel: hazardDistanceLabel(item, along, input.miles),
      etaLabel: timing.enterMin != null ? fmtMin(timing.enterMin) : null,
      color: timelineItemBandColor(item),
    };
  });
}
