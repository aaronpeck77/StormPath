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
  track: "nws" | "radar" | "road" | "forecast";
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
  nws:      { label: "NWS",      emptyText: "No active NWS alerts on route" },
  radar:    { label: "Radar",    emptyText: "No radar precipitation detected" },
  road:     { label: "Road",     emptyText: "No road hazards detected" },
  forecast: { label: "Forecast", emptyText: "No significant weather forecast" },
};

const TRACK_ORDER = ["nws", "radar", "forecast", "road"] as const;

/** Minimum visual band width (% of rail) so tiny/point impacts are visible. */
const MIN_BAND_PCT = 2.5;

function legendDetailText(item: TimelineItem): string | null {
  const detail = (item.detailLine ?? "").trim();
  if (!detail) return null;
  const label = item.label.trim().toLowerCase();
  if (detail.toLowerCase() === label) return null;
  return detail;
}

type ItemVisual = {
  sPct: number;
  wPct: number;
  passed: boolean;
  inside: boolean;
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
      }).timingLine;

      return { sPct, wPct, passed, inside, timing };
    });
  }, [items, totalMeters, userAlongMeters, planEtaMinutes, driveEtaMinutes]);
}

function RouteHazardLegend({
  items,
  itemVisuals,
  showTrackLabel = true,
}: {
  items: TimelineItem[];
  itemVisuals: ItemVisual[];
  showTrackLabel?: boolean;
}) {
  const legendEntries = useMemo(
    () =>
      [...items]
        .map((item, i) => ({ item, vis: itemVisuals[i]! }))
        .filter(({ vis }) => !vis.passed)
        .sort((a, b) => a.item.startMeters - b.item.startMeters),
    [items, itemVisuals]
  );

  if (!legendEntries.length) return null;

  return (
    <ul className="rhtz__legend" aria-label="Hazards along your route in encounter order">
      {legendEntries.map(({ item, vis }) => (
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
            <span className="rhtz__legend-dot" aria-hidden />
            <span className="rhtz__legend-body">
              {showTrackLabel ? (
                <span className="rhtz__legend-track">{TRACK_META[item.track]?.label ?? item.track}</span>
              ) : null}
              <span className="rhtz__legend-label">{item.label}</span>
              {(() => {
                const detail = legendDetailText(item);
                return detail ? <span className="rhtz__legend-detail">{detail}</span> : null;
              })()}
              {vis.timing && vis.timing !== "On your planned route" ? (
                <span className="rhtz__legend-timing">{vis.timing}</span>
              ) : null}
            </span>
          </div>
        </li>
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
        {rerouteBusy ? "Finding route…" : "Reroute around traffic"}
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
    return (
      <div className="rhtz rhtz--legend-only">
        <div className="rhtz__header">
          <span className="rhtz__header-title">On your route</span>
          <span className="rhtz__header-dest">Nearest ahead first · full detail</span>
        </div>
        <RouteHazardLegend items={items} itemVisuals={itemVisuals} showTrackLabel={false} />
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
                      className={`rhtz__band rhtz__band--${item.severity}${vis.passed ? " rhtz__band--passed" : ""}${item.crossesRoute === false ? " rhtz__band--nearby" : ""}`}
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
    : imp.source === "tomorrowIo" ? "forecast"
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
  };
}
