/**
 * Single source of truth for route hazards: progress-strip bands, map route highlights,
 * and progress-bar glance panel all derive from the same timeline model.
 */

import type { RouteAlert } from "./routeAlerts";
import type { RouteImpact } from "./routeImpacts";
import { routeImpactToRouteAlert } from "./routeImpacts";
import {
  formatRouteAlertTiming,
  fmtMi,
  fmtMin,
  isAlertExpired,
} from "./routeAlertTiming";
import type { RouteChunkCalloutItem } from "./routeProgressChunkList";
import { squeezeForSummary } from "./progressCalloutCopy";
import type { StormProgressStripBand } from "../weatherAlerts/geometryOverlap";
import {
  impactToTimelineItem,
  mergeOverlappingTimelineItems,
  type TimelineItem,
} from "../ui/RouteHazardTimeline";
import { timelineItemBandColor } from "./timelineBandColors";

export type { TimelineItem };
export { timelineItemBandColor, timelineTrackFamily } from "./timelineBandColors";
export type { TimelineBandFamily } from "./timelineBandColors";

/** Advisory NWS strip band (matches StormAdvisoryBar.StormStripBand). */
export type RouteAheadStormBand = {
  id: string;
  event: string;
  severity: "info" | "caution" | "serious" | "avoid";
  startMeters: number;
  endMeters: number;
  expiresIso: string | null;
  alertId: string | null;
  crossesRoute?: boolean;
  /** Distant ahead — timeline only until you get closer. */
  coarsePreview?: boolean;
  /** Minor flood/hydro — advisory mention only; skip progress strip / map paint. */
  stripMuted?: boolean;
};

export type BuildRouteAheadTimelineOpts = {
  routeTotalMeters: number;
  userAlongMeters: number;
  planEtaMinutes: number | null;
  driveEtaMinutes?: number | null;
  stormStripBands: RouteAheadStormBand[];
  routeImpacts: RouteImpact[];
  /** NWS detail for strip bands — same helper as advisory panel. */
  stripBandDetail?: (
    band: RouteAheadStormBand
  ) => { severityLabel: string | null; detail: string | null };
};

function impactSectionBucket(i: RouteImpact): "weather" | "road" {
  switch (i.category) {
    case "weather":
    case "winter":
    case "wind":
    case "flooding":
    case "visibility":
      return "weather";
    case "traffic":
    case "closure":
    case "incident":
    case "construction":
      return "road";
    default:
      return "road";
  }
}

function splitRouteImpacts(routeImpacts: RouteImpact[]) {
  const radarImpacts: RouteImpact[] = [];
  const forecastImpacts: RouteImpact[] = [];
  const roadImpacts: RouteImpact[] = [];
  for (const i of routeImpacts) {
    if (impactSectionBucket(i) === "road") {
      roadImpacts.push(i);
      continue;
    }
    if (i.source === "radar") radarImpacts.push(i);
    else if (i.source === "tomorrowIo") forecastImpacts.push(i);
    else if (i.source !== "nws") radarImpacts.push(i);
  }
  return { radarImpacts, forecastImpacts, roadImpacts };
}

/** Shared timeline for progress strip, map highlights, and glance panel. */
export function buildRouteAheadTimeline(opts: BuildRouteAheadTimelineOpts): TimelineItem[] {
  const {
    routeTotalMeters,
    userAlongMeters,
    planEtaMinutes,
    driveEtaMinutes = null,
    stormStripBands,
    routeImpacts,
    stripBandDetail,
  } = opts;

  if (routeTotalMeters <= 0) return [];

  const timelineItems: TimelineItem[] = [];

  for (const band of stormStripBands) {
    if (isAlertExpired(band.expiresIso)) continue;
    const timing = formatRouteAlertTiming({
      startMeters: band.startMeters,
      endMeters: band.endMeters,
      userAlongMeters,
      totalMeters: routeTotalMeters,
      planEtaMinutes,
      driveEtaMinutes,
      expiresIso: band.expiresIso,
      crossesRoute: band.crossesRoute,
    });
    if (timing.passed) continue;
    const extra = stripBandDetail?.(band) ?? { severityLabel: null, detail: null };
    const nwsDetail = (extra.detail ?? "").trim() || null;
    timelineItems.push({
      id: band.id,
      track: "nws",
      label: band.event,
      severity: band.severity,
      startMeters: band.startMeters,
      endMeters: band.endMeters,
      detailLine: nwsDetail || null,
      expiresIso: band.expiresIso,
      crossesRoute: band.crossesRoute !== false,
      coarsePreview: band.coarsePreview,
      stripMuted: band.stripMuted,
    });
  }

  const { radarImpacts, forecastImpacts, roadImpacts } = splitRouteImpacts(routeImpacts);
  const pushIfActive = (imp: RouteImpact) => {
    if (imp.endMeters <= userAlongMeters) return;
    timelineItems.push(impactToTimelineItem(imp));
  };
  for (const imp of radarImpacts) pushIfActive(imp);
  for (const imp of forecastImpacts) pushIfActive(imp);
  for (const imp of roadImpacts) pushIfActive(imp);

  return mergeOverlappingTimelineItems(timelineItems, routeTotalMeters);
}

/** Colored spans for the progress strip and map route halo. */
export function timelineToProgressStripBands(
  items: TimelineItem[],
  opts?: { omitCoarsePreview?: boolean }
): StormProgressStripBand[] {
  const out: StormProgressStripBand[] = [];
  for (const item of items) {
    if (opts?.omitCoarsePreview && item.coarsePreview) continue;
    if (item.stripMuted) continue;
    const span = item.endMeters - item.startMeters;
    if (span < 8 && item.track !== "nws") continue;
    out.push({
      startM: item.startMeters,
      endM: item.endMeters,
      lineHex: timelineItemBandColor(item),
      severity: item.severity,
    });
  }
  return out;
}

/** Road / hazard point alerts for map corridor overlay (weather uses strip bands). */
export function timelineToMapCorridorAlerts(
  items: TimelineItem[],
  routeImpacts: RouteImpact[]
): RouteAlert[] {
  const byId = new Map(routeImpacts.map((i) => [i.id, i]));
  const out: RouteAlert[] = [];
  for (const item of items) {
    if (item.track === "nws" || item.track === "radar" || item.track === "forecast") continue;
    const imp = byId.get(item.id);
    if (imp) out.push(routeImpactToRouteAlert(imp));
  }
  return out;
}

/** Progress strip / map / info panel — skip minor hydro (advisory mention only). */
export function timelineItemsForProgressRail(items: TimelineItem[]): TimelineItem[] {
  return items.filter((item) => !item.stripMuted);
}

/** Progress-bar info panel rows — brief copy + ETA / still-active timing from advisory logic. */
export function buildRouteAheadCalloutSegments(opts: {
  items: TimelineItem[];
  totalMeters: number;
  userAlongMeters: number;
  planEtaMinutes: number | null;
  driveEtaMinutes?: number | null;
}): RouteChunkCalloutItem[] {
  const { items, totalMeters, userAlongMeters, planEtaMinutes, driveEtaMinutes = null } = opts;
  const visible = timelineItemsForProgressRail(items);
  if (totalMeters <= 0 || !visible.length) return [];

  return visible.map((item) => {
    const timing = formatRouteAlertTiming({
      startMeters: item.startMeters,
      endMeters: item.endMeters,
      userAlongMeters,
      totalMeters,
      planEtaMinutes,
      driveEtaMinutes,
      expiresIso: item.expiresIso,
      crossesRoute: item.crossesRoute,
    });
    const midM = (item.startMeters + item.endMeters) / 2;
    const alongT = Math.min(1, Math.max(0, midM / totalMeters));
    const trackLabel =
      item.track === "nws"
        ? "NWS"
        : item.track === "radar"
          ? "Radar"
          : item.track === "forecast"
            ? "Forecast"
            : "Road";
    const detail = (item.detailLine ?? "").trim();
    const summaryParts = [detail, timing.timingLine].filter(Boolean);
    const summary = squeezeForSummary(summaryParts.join(" · "), 120);
    const tooltip = [`${trackLabel}: ${item.label}`, detail, timing.timingLine].filter(Boolean).join("\n\n");

    return {
      key: `route-ahead-${item.id}`,
      scope: "segment" as const,
      title: `${trackLabel} · ${item.label}`,
      summary,
      tooltip,
      color: timelineItemBandColor(item),
      alongT,
      alongPct: Math.round(alongT * 100),
      segmentStartM: item.startMeters,
      segmentEndM: item.endMeters,
    };
  });
}

export type RouteAheadRelevance = "active" | "ending" | "clear";

export type RouteAheadGlanceCard = {
  id: string;
  track: TimelineItem["track"];
  label: string;
  severity: TimelineItem["severity"];
  color: string;
  startMeters: number;
  aheadLabel: string;
  etaLabel: string | null;
  relevance: RouteAheadRelevance | null;
  /** Driver is inside this hazard span along the route right now. */
  inside: boolean;
  alongPct: number;
  tooltip: string;
  /** One-line NWS / road detail for glance panel. */
  detailLine: string | null;
};

function relevanceKind(note: string | null): RouteAheadRelevance | null {
  if (!note) return null;
  if (note.includes("still active")) return "active";
  if (note.includes("ending around")) return "ending";
  if (note.includes("over before")) return "clear";
  return null;
}

/** Compact one-line cards for the progress-bar glance panel (driving-safe). */
export function buildRouteAheadGlanceCards(opts: {
  items: TimelineItem[];
  totalMeters: number;
  userAlongMeters: number;
  planEtaMinutes: number | null;
  driveEtaMinutes?: number | null;
}): RouteAheadGlanceCard[] {
  const { items, totalMeters, userAlongMeters, planEtaMinutes, driveEtaMinutes = null } = opts;
  const visible = timelineItemsForProgressRail(items);
  if (totalMeters <= 0 || !visible.length) return [];

  const cards: RouteAheadGlanceCard[] = [];
  for (const item of visible) {
    const timing = formatRouteAlertTiming({
      startMeters: item.startMeters,
      endMeters: item.endMeters,
      userAlongMeters,
      totalMeters,
      planEtaMinutes,
      driveEtaMinutes,
      expiresIso: item.expiresIso,
      crossesRoute: item.crossesRoute,
    });
    if (timing.passed) continue;

    const trackLabel =
      item.track === "nws"
        ? "NWS"
        : item.track === "radar"
          ? "Radar"
          : item.track === "forecast"
            ? "Forecast"
            : "Road";
    const detail = (item.detailLine ?? "").trim();
    const tooltip = [`${trackLabel}: ${item.label}`, detail, timing.timingLine].filter(Boolean).join("\n\n");
    const midM = (item.startMeters + item.endMeters) / 2;
    const alongPct = Math.round(Math.min(1, Math.max(0, midM / totalMeters)) * 100);
    const enterLabel = fmtMin(timing.enterMin);
    const etaLabel = enterLabel ? `~${enterLabel}` : null;

    let aheadLabel = timing.locationLine;
    if (!timing.inside && timing.aheadMeters > 0 && !aheadLabel.includes("ahead")) {
      aheadLabel = `${fmtMi(timing.aheadMeters)} ahead`;
    }

    cards.push({
      id: item.id,
      track: item.track,
      label: item.label,
      severity: item.severity,
      color: timelineItemBandColor(item),
      startMeters: item.startMeters,
      aheadLabel,
      etaLabel,
      relevance: relevanceKind(timing.relevanceNote),
      inside: timing.inside,
      alongPct,
      tooltip,
      detailLine: detail ? squeezeForSummary(detail, 56) : null,
    });
  }

  return cards.sort((a, b) => a.startMeters - b.startMeters);
}
