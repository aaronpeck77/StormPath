import { useMemo } from "react";
import { formatRouteAlertTiming } from "../nav/routeAlertTiming";
import { timelineItemBandColor } from "../nav/timelineBandColors";
import type { RouteImpact } from "../nav/routeImpacts";

/**
 * One hazard item displayed on the timeline.  Raw meters are passed in;
 * the component derives all visual percentages and timing text internally
 * so callers only need to supply position data.
 */
export type TimelineItem = {
  id: string;
  /** Which horizontal track this item lives on. */
  track: "nws" | "radar" | "road" | "forecast" | "wind";
  /** Event / headline label (e.g. "Flood Advisory", "Heavy rain on route"). */
  label: string;
  severity: "info" | "caution" | "serious" | "avoid";
  /** Along-route overlap start (m). */
  startMeters: number;
  /** Along-route overlap end (m). */
  endMeters: number;
  /** One-line NWS glance / road-effect text. */
  detailLine?: string | null;
  /** ISO expiry — used in legend for NWS items. */
  expiresIso?: string | null;
  /**
   * false → polygon is within the NWS corridor buffer but doesn't cross the
   * route line; the band is shown as a dashed outline so the driver knows it
   * is nearby rather than directly in the path.
   */
  crossesRoute?: boolean;
  /** Distant ahead weather — shown on timeline/advisory, skipped for map polygon work. */
  coarsePreview?: boolean;
  /** Minor flood/hydro — listed in advisory / callouts, not painted on progress strip. */
  stripMuted?: boolean;
  /** Expires before driver ETA — advisory list only, not map/strip. */
  etaStale?: boolean;
  /** Onset after now; overlaps driver arrival window. */
  developingLater?: boolean;
  onClick?: () => void;
};

export type RouteHazardTimelineProps = {
  items: TimelineItem[];
  totalMeters: number;
  userAlongMeters: number;
  planEtaMinutes: number | null;
  driveEtaMinutes?: number | null;
  /** Full graph + legend (advisory legacy) or detailed list only (progress panel has the graph). */
  variant?: "full" | "legendOnly";
  /** Advisory route panel: split legend into NWS vs road sections. */
  groupLegendByTrack?: boolean;
  /** Flat feed rows — no extra header chrome (nested in adv-dash). */
  compactFeed?: boolean;
  /** Show the reroute button when traffic warrants it. */
  showRerouteCta?: boolean;
  onReroute?: () => void;
  rerouteBusy?: boolean;
};

/* ── helpers ──────────────────────────────────────────────────────────────── */

function pct(meters: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, (meters / total) * 100));
}

const TRACK_META: Record<string, { label: string; emptyText: string }> = {
  nws:   { label: "NWS",   emptyText: "No active NWS alerts on route" },
  radar: { label: "Radar · now", emptyText: "No current radar echo along route" },
  wind:  { label: "Wind",  emptyText: "No significant wind along route" },
  road:  { label: "Road",  emptyText: "No road hazards detected" },
};

const TRACK_ORDER = ["nws", "road"] as const; // radar → RouteRadarStrip strata, wind → top graph line

/** Minimum visual band width (% of rail) so tiny/point impacts are visible. */
const MIN_BAND_PCT = 2.5;

function legendDetailText(item: TimelineItem): string | null {
  const detail = (item.detailLine ?? "").trim();
  if (!detail) return null;
  const label = item.label.trim().toLowerCase();
  if (detail.toLowerCase() === label) return null;
  return detail;
}

function compactFeedItemHasInfo(item: TimelineItem, vis: ItemVisual): boolean {
  const detail = legendDetailText(item);
  const timing =
    vis.timingDetail ??
    (vis.locationLine && vis.locationLine !== "On your planned route" ? vis.locationLine : null);
  if (detail || timing) return true;
  if (item.track !== "road") return item.label.trim().length > 0;
  const label = item.label.trim().toLowerCase();
  if (!label || label === "traffic" || label === "traffic alert") return false;
  return item.label.trim().length > 0;
}

type ItemVisual = {
  sPct: number;
  wPct: number;
  passed: boolean;
  inside: boolean;
  locationLine: string;
  timingDetail: string | null;
  timing: string;
};

function useTimelineItemVisuals(
  items: TimelineItem[],
  totalMeters: number,
  userAlongMeters: number,
  planEtaMinutes: number | null,
  driveEtaMinutes: number | null
): ItemVisual[] {
  return useMemo(() => {
    return items.map((item) => {
      const sPct = pct(item.startMeters, totalMeters);
      const ePct = pct(item.endMeters, totalMeters);
      const wPct = Math.max(MIN_BAND_PCT, ePct - sPct);
      const passed = item.endMeters <= userAlongMeters;
      const inside = userAlongMeters >= item.startMeters && userAlongMeters < item.endMeters;
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

      return {
        sPct,
        wPct,
        passed,
        inside,
        locationLine: timing.locationLine,
        timingDetail: timing.timingDetail,
        timing: timing.timingLine,
      };
    });
  }, [items, totalMeters, userAlongMeters, planEtaMinutes, driveEtaMinutes]);
}

function LegendEntryRow({
  item,
  vis,
  showTrackLabel,
}: {
  item: TimelineItem;
  vis: ItemVisual;
  showTrackLabel: boolean;
}) {
  return (
    <li key={item.id}>
      <div
        className={`rhtz__legend-item rhtz__legend-item--${item.severity}${item.onClick ? " rhtz__legend-item--tappable" : ""}`}
        role={item.onClick ? "button" : undefined}
        tabIndex={item.onClick ? 0 : undefined}
        onClick={item.onClick}
        onKeyDown={
          item.onClick
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  item.onClick?.();
                }
              }
            : undefined
        }
      >
        <span className="rhtz__legend-dot" style={{ background: timelineItemBandColor(item) }} aria-hidden />
        <span className="rhtz__legend-body">
          {showTrackLabel ? (
            <span className="rhtz__legend-track">{TRACK_META[item.track]?.label ?? item.track}</span>
          ) : null}
          <span className="rhtz__legend-label">{item.label}</span>
          {vis.locationLine && vis.locationLine !== "On your planned route" ? (
            <span className={`rhtz__legend-ahead${vis.inside ? " rhtz__legend-ahead--now" : ""}`}>
              {vis.locationLine}
            </span>
          ) : null}
          {(() => {
            const detail = legendDetailText(item);
            return detail ? <span className="rhtz__legend-detail">{detail}</span> : null;
          })()}
          {vis.timingDetail ? <span className="rhtz__legend-timing">{vis.timingDetail}</span> : null}
        </span>
      </div>
    </li>
  );
}

function RouteHazardLegend({
  items,
  itemVisuals,
  showTrackLabel = true,
  groupByTrack = false,
  compactFeed = false,
}: {
  items: TimelineItem[];
  itemVisuals: ItemVisual[];
  showTrackLabel?: boolean;
  groupByTrack?: boolean;
  compactFeed?: boolean;
}) {
  const legendEntries = useMemo(
    () =>
      [...items]
        .map((item, i) => ({ item, vis: itemVisuals[i]! }))
        .filter(({ item, vis }) => !vis.passed && compactFeedItemHasInfo(item, vis))
        .sort((a, b) => a.item.startMeters - b.item.startMeters),
    [items, itemVisuals]
  );

  if (!legendEntries.length) return null;

  if (compactFeed) {
    return (
      <>
        {legendEntries.map(({ item, vis }) => {
          const trackTag =
            item.track === "road" ? "Road" : item.track === "nws" ? "NWS" : item.track === "wind" ? "Wind" : "Wx";
          const tagTone = item.track === "road" ? "road" : "nws";
          const detail = legendDetailText(item);
          const timing =
            vis.timingDetail ??
            (vis.locationLine && vis.locationLine !== "On your planned route" ? vis.locationLine : null);
          return (
            <div
              key={item.id}
              className={`adv-dash__feed-row adv-dash__feed-row--${item.severity}${item.onClick ? " adv-dash__feed-row--tap" : ""}`}
              role={item.onClick ? "button" : undefined}
              tabIndex={item.onClick ? 0 : undefined}
              onClick={item.onClick}
              onKeyDown={
                item.onClick
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        item.onClick?.();
                      }
                    }
                  : undefined
              }
            >
              <span className={`adv-dash__feed-dot adv-dash__feed-dot--${item.severity}`} aria-hidden />
              <span className={`adv-dash__feed-tag adv-dash__feed-tag--${tagTone}`}>{trackTag}</span>
              <span className="adv-dash__feed-body">
                <span className="adv-dash__feed-title">{item.label}</span>
                {detail ? <span className="adv-dash__feed-detail">{detail}</span> : null}
                {timing ? <span className="adv-dash__feed-timing">{timing}</span> : null}
              </span>
            </div>
          );
        })}
      </>
    );
  }

  if (groupByTrack) {
    const nwsEntries = legendEntries.filter(({ item }) => item.track === "nws" || item.track === "wind");
    const roadEntries = legendEntries.filter(({ item }) => item.track === "road");
    const otherEntries = legendEntries.filter(
      ({ item }) => item.track !== "nws" && item.track !== "wind" && item.track !== "road"
    );

    const renderGroup = (
      title: string,
      entries: typeof legendEntries,
      ariaLabel: string
    ) => {
      if (!entries.length) return null;
      return (
        <div className="rhtz__legend-group">
          <p className="rhtz__legend-group-title">{title}</p>
          <ul className="rhtz__legend" aria-label={ariaLabel}>
            {entries.map(({ item, vis }) => (
              <LegendEntryRow key={item.id} item={item} vis={vis} showTrackLabel={showTrackLabel} />
            ))}
          </ul>
        </div>
      );
    };

    return (
      <div className="rhtz__legend-groups">
        {renderGroup("NWS & weather corridor", nwsEntries, "NWS and weather hazards along your route")}
        {renderGroup("Road & traffic", roadEntries, "Road hazards along your route")}
        {otherEntries.length > 0
          ? renderGroup("Other", otherEntries, "Other hazards along your route")
          : null}
      </div>
    );
  }

  return (
    <ul className="rhtz__legend" aria-label="Hazards along your route in encounter order">
      {legendEntries.map(({ item, vis }) => (
        <LegendEntryRow key={item.id} item={item} vis={vis} showTrackLabel={showTrackLabel} />
      ))}
    </ul>
  );
}

function RouteHazardReroute({
  showRerouteCta,
  onReroute,
  rerouteBusy,
}: {
  showRerouteCta: boolean;
  onReroute?: () => void;
  rerouteBusy: boolean;
}) {
  if (!showRerouteCta || !onReroute) return null;
  return (
    <p className="rhtz__reroute">
      <button
        type="button"
        className="storm-advisory-bar__btn storm-advisory-bar__btn--traffic"
        onClick={onReroute}
        disabled={rerouteBusy}
      >
        {rerouteBusy ? "Finding alternate route" : "Reroute around traffic"}
      </button>
    </p>
  );
}

/* ── component ────────────────────────────────────────────────────────────── */

export function RouteHazardTimeline({
  items,
  totalMeters,
  userAlongMeters,
  planEtaMinutes,
  driveEtaMinutes = null,
  variant = "full",
  groupLegendByTrack = false,
  compactFeed = false,
  showRerouteCta = false,
  onReroute,
  rerouteBusy = false,
}: RouteHazardTimelineProps) {
  const youPct = pct(userAlongMeters, totalMeters);
  const itemVisuals = useTimelineItemVisuals(
    items,
    totalMeters,
    userAlongMeters,
    planEtaMinutes,
    driveEtaMinutes
  );

  const activeLegendCount = useMemo(
    () => items.filter((_, i) => !itemVisuals[i]?.passed).length,
    [items, itemVisuals]
  );

  if (variant === "legendOnly") {
    if (activeLegendCount === 0 && !showRerouteCta) return null;
    if (compactFeed) {
      return (
        <>
          <RouteHazardLegend
            items={items}
            itemVisuals={itemVisuals}
            showTrackLabel={false}
            compactFeed
          />
          <RouteHazardReroute
            showRerouteCta={showRerouteCta}
            onReroute={onReroute}
            rerouteBusy={rerouteBusy}
          />
        </>
      );
    }
    return (
      <div className={`rhtz rhtz--legend-only${groupLegendByTrack ? " rhtz--grouped" : ""}`}>
        {!groupLegendByTrack ? (
          <div className="rhtz__header">
            <span className="rhtz__header-title">On your route</span>
            <span className="rhtz__header-dest">Nearest ahead first · full detail</span>
          </div>
        ) : null}
        <RouteHazardLegend
          items={items}
          itemVisuals={itemVisuals}
          showTrackLabel={false}
          groupByTrack={groupLegendByTrack}
        />
        <RouteHazardReroute
          showRerouteCta={showRerouteCta}
          onReroute={onReroute}
          rerouteBusy={rerouteBusy}
        />
      </div>
    );
  }

  /* Group items by track for the graph rows. */
  const byTrack = useMemo(() => {
    const map: Record<string, Array<{ item: TimelineItem; vis: ItemVisual }>> = {
      nws: [],
      radar: [],
      road: [],
      forecast: [],
    };
    items.forEach((item, i) => {
      map[item.track]?.push({ item, vis: itemVisuals[i]! });
    });
    return map;
  }, [items, itemVisuals]);

  const activeTracks = TRACK_ORDER.filter((t) => byTrack[t]!.length > 0);

  if (!activeTracks.length) return null;

  /* Left-column label width as a CSS custom property. */
  const LABEL_W = 48;

  return (
    <div className="rhtz">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="rhtz__header">
        <span className="rhtz__header-title">Route ahead</span>
        <span className="rhtz__header-dest">In encounter order · YOU → DEST</span>
      </div>

      {/* ── Scrollable graph ───────────────────────────────────────────── */}
      <div className="rhtz__scroll-wrap">
        <div className="rhtz__graph-inner" style={{ "--rhtz-label-w": `${LABEL_W}px` } as React.CSSProperties}>

          {/* YOU vertical line */}
          <div
            className="rhtz__you-line"
            style={{ left: `calc(${LABEL_W}px + (100% - ${LABEL_W}px) * ${youPct / 100})` }}
            aria-hidden
          />

          {/* Track rows */}
          {TRACK_ORDER.map((track) => {
            const meta = TRACK_META[track]!;
            const entries = byTrack[track]!;
            if (!entries.length) return null;
            return (
              <div key={track} className="rhtz__row">
                <span className="rhtz__row-label">{meta.label}</span>
                <div className="rhtz__row-rail">
                  <div className="rhtz__rail-bg" />
                  {entries.map(({ item, vis }) => (
                    <div
                      key={item.id}
                      className={`rhtz__band rhtz__band--${item.severity}${vis.passed ? " rhtz__band--passed" : ""}${item.crossesRoute === false ? " rhtz__band--nearby" : ""}${item.coarsePreview ? " rhtz__band--preview" : ""}`}
                      style={{
                        left: `${vis.sPct}%`,
                        width: `${vis.wPct}%`,
                        background: vis.passed ? undefined : timelineItemBandColor(item),
                      }}
                      title={`${item.label}${vis.timing ? " · " + vis.timing : ""}`}
                      role={item.onClick ? "button" : undefined}
                      tabIndex={item.onClick ? 0 : undefined}
                      onClick={item.onClick}
                      onKeyDown={item.onClick ? (e) => { if (e.key === "Enter") item.onClick?.(); } : undefined}
                    >
                      {/* Label inside band when it's wide enough to show it */}
                      {vis.wPct >= 14 && (
                        <span className="rhtz__band-label">{item.label}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {/* Axis — YOU and DEST labels only, no mile markers */}
          <div className="rhtz__axis">
            <span className="rhtz__axis-spacer" style={{ width: LABEL_W }} aria-hidden />
            <div className="rhtz__axis-ticks">
              <span className="rhtz__axis-you" style={{ left: `${youPct}%` }} aria-hidden>YOU</span>
              <span className="rhtz__axis-dest" aria-hidden>DEST</span>
            </div>
          </div>
        </div>
      </div>

      <RouteHazardLegend items={items} itemVisuals={itemVisuals} />
      <RouteHazardReroute
        showRerouteCta={showRerouteCta}
        onReroute={onReroute}
        rerouteBusy={rerouteBusy}
      />
    </div>
  );
}

/* ── Helper: build TimelineItems from advisory data ─────────────────────── */

function impactDetailLine(imp: RouteImpact): string | null {
  const effect = (imp.roadEffect || "").trim();
  const detail = (imp.detail || "").trim();
  if (!effect && !detail) return null;
  if (!effect) return detail;
  if (!detail || detail === effect) return effect;
  const dl = detail.toLowerCase();
  const el = effect.toLowerCase();
  if (dl.includes(el) || el.includes(dl.slice(0, Math.min(28, dl.length)))) return detail;
  return `${effect} · ${detail}`;
}

/** Collapse adjacent/overlapping items with the same track + label (e.g. repeated “Light rain on route”). */
export function mergeOverlappingTimelineItems(
  items: TimelineItem[],
  totalMeters: number
): TimelineItem[] {
  if (items.length <= 1 || totalMeters <= 0) return items;
  const sorted = [...items].sort((a, b) => a.startMeters - b.startMeters);
  const gapM = totalMeters * 0.06;
  const out: TimelineItem[] = [];
  for (const item of sorted) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.track === item.track &&
      prev.label.trim().toLowerCase() === item.label.trim().toLowerCase() &&
      item.startMeters <= prev.endMeters + gapM
    ) {
      prev.endMeters = Math.max(prev.endMeters, item.endMeters);
      if (!prev.detailLine && item.detailLine) prev.detailLine = item.detailLine;
      continue;
    }
    out.push({ ...item });
  }
  return out;
}

export function impactToTimelineItem(imp: RouteImpact): TimelineItem {
  const track: TimelineItem["track"] =
    imp.source === "radar" ? "radar"
    : imp.source === "nws" ? "nws"
    : imp.source === "wind" || imp.source === "windGust" ? "wind"
    : imp.source === "tomorrowIo" ? "forecast"  // list-only — not in graph TRACK_ORDER
    : "road";
  return {
    id: imp.id,
    track,
    label: imp.driverHeadline,
    severity: imp.severity,
    startMeters: imp.startMeters,
    endMeters: imp.endMeters,
    detailLine: impactDetailLine(imp),
    crossesRoute: true,
    stripMuted: track === "forecast" || track === "radar" || imp.source === "windGust",
  };
}
