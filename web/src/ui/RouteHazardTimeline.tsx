import { useMemo } from "react";
import type { RouteImpact } from "../nav/routeImpacts";

/**
 * One hazard item displayed on the timeline.  Raw meters are passed in;
 * the component derives all visual percentages and timing text internally
 * so callers only need to supply position data.
 */
export type TimelineItem = {
  id: string;
  /** Which horizontal track this item lives on. */
  track: "nws" | "radar" | "road";
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
  /** Show the reroute button when traffic warrants it. */
  showRerouteCta?: boolean;
  onReroute?: () => void;
  rerouteBusy?: boolean;
};

/* ── helpers ──────────────────────────────────────────────────────────────── */

const METERS_PER_MILE = 1609.34;

function pct(meters: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, (meters / total) * 100));
}

function fmtMi(meters: number): string {
  if (!Number.isFinite(meters) || meters <= 0) return "0 mi";
  const mi = meters / METERS_PER_MILE;
  return mi < 10 ? `${mi.toFixed(1)} mi` : `${Math.round(mi)} mi`;
}

function fmtMin(min: number | null | undefined): string | null {
  if (min == null || !Number.isFinite(min) || min < 0) return null;
  if (min < 1) return "now";
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

function fmtExpires(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
}

const TRACK_META: Record<string, { label: string; emptyText: string }> = {
  nws:   { label: "NWS",   emptyText: "No active NWS alerts on route" },
  radar: { label: "Radar", emptyText: "No radar precipitation detected" },
  road:  { label: "Road",  emptyText: "No road hazards detected" },
};

const TRACK_ORDER = ["nws", "radar", "road"] as const;

const BAND_COLORS: Record<string, string> = {
  avoid:   "#ef4444",
  serious: "#f97316",
  caution: "#eab308",
  info:    "#60a5fa",
};

/** Minimum visual band width (% of rail) so tiny/point impacts are visible. */
const MIN_BAND_PCT = 2.5;

/* ── component ────────────────────────────────────────────────────────────── */

export function RouteHazardTimeline({
  items,
  totalMeters,
  userAlongMeters,
  planEtaMinutes,
  driveEtaMinutes = null,
  showRerouteCta = false,
  onReroute,
  rerouteBusy = false,
}: RouteHazardTimelineProps) {
  const youPct = pct(userAlongMeters, totalMeters);

  /* Pre-compute timing text for each item. */
  const itemVisuals = useMemo(() => {
    const remainingM = Math.max(0, totalMeters - userAlongMeters);
    const effectiveEta =
      driveEtaMinutes != null && Number.isFinite(driveEtaMinutes)
        ? driveEtaMinutes
        : planEtaMinutes != null && Number.isFinite(planEtaMinutes) && totalMeters > 0
          ? planEtaMinutes * (remainingM / totalMeters)
          : null;

    const etaForM = (m: number): number | null => {
      if (effectiveEta == null || remainingM <= 0) return null;
      const ahead = Math.max(0, m - userAlongMeters);
      if (ahead <= 0) return 0;
      return effectiveEta * (ahead / remainingM);
    };

    return items.map((item) => {
      const sPct = pct(item.startMeters, totalMeters);
      const ePct = pct(item.endMeters, totalMeters);
      const wPct = Math.max(MIN_BAND_PCT, ePct - sPct);
      const passed = item.endMeters <= userAlongMeters;
      const inside = userAlongMeters >= item.startMeters && userAlongMeters < item.endMeters;
      const crosses = item.crossesRoute !== false;

      const enterMin = etaForM(item.startMeters);
      const exitMin = etaForM(item.endMeters);
      const enterLabel = fmtMin(enterMin);
      const exitLabel = fmtMin(exitMin);
      const lengthMeters = Math.max(0, item.endMeters - item.startMeters);
      const isPoint = lengthMeters < 50;
      const aheadMeters = Math.max(0, item.startMeters - userAlongMeters);
      const aheadMi = isPoint ? fmtMi(aheadMeters) : null;
      const lengthMi = !isPoint ? fmtMi(lengthMeters) : null;
      const expiresLabel = fmtExpires(item.expiresIso);

      const timing = passed
        ? "Passed"
        : !crosses
          ? `Nearby · within storm corridor${expiresLabel ? ` · exp ${expiresLabel}` : ""}`
          : inside
            ? isPoint
              ? `At this location now${expiresLabel ? ` · exp ${expiresLabel}` : ""}`
              : `In zone now · exits in ${exitLabel ?? "—"}`
            : isPoint
              ? enterLabel
                ? `${aheadMi} ahead · in ${enterLabel}${expiresLabel ? ` · exp ${expiresLabel}` : ""}`
                : `${aheadMi} ahead${expiresLabel ? ` · exp ${expiresLabel}` : ""}`
              : enterLabel
                ? `Enter in ${enterLabel} · ${lengthMi} long${expiresLabel ? ` · exp ${expiresLabel}` : ""}`
                : `${lengthMi} long${expiresLabel ? ` · exp ${expiresLabel}` : ""}`;

      return { sPct, wPct, passed, inside, timing };
    });
  }, [items, totalMeters, userAlongMeters, planEtaMinutes, driveEtaMinutes]);

  /* Group items by track for the graph rows. */
  const byTrack = useMemo(() => {
    const map: Record<string, Array<{ item: TimelineItem; vis: (typeof itemVisuals)[number] }>> = {
      nws: [], radar: [], road: [],
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
        <span className="rhtz__header-dest">YOU → DEST</span>
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
                        background: vis.passed ? undefined : BAND_COLORS[item.severity],
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

      {/* ── Detail cards — sorted closest-first ─────────────────────── */}
      <div className="rhtz__cards">
        {[...items]
          .map((item, i) => ({ item, vis: itemVisuals[i]! }))
          .sort((a, b) => a.item.startMeters - b.item.startMeters)
          .map(({ item, vis }) => {
          const color = BAND_COLORS[item.severity] ?? "#94a3b8";
          return (
            <div
              key={item.id}
              className={`rhtz__card rhtz__card--${item.severity}${vis.passed ? " rhtz__card--passed" : ""}${item.onClick ? " rhtz__card--tappable" : ""}`}
              style={{ borderLeftColor: color }}
              role={item.onClick ? "button" : undefined}
              tabIndex={item.onClick ? 0 : undefined}
              onClick={item.onClick}
              onKeyDown={item.onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); item.onClick?.(); } } : undefined}
            >
              <div className="rhtz__card-name">{item.label}</div>
              {item.detailLine && (
                <div className="rhtz__card-detail">{item.detailLine}</div>
              )}
              <div className="rhtz__card-timing">{vis.timing}</div>
            </div>
          );
        })}
      </div>

      {/* Reroute CTA */}
      {showRerouteCta && onReroute && (
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
      )}
    </div>
  );
}

/* ── Helper: build TimelineItems from advisory data ─────────────────────── */

export function impactToTimelineItem(imp: RouteImpact): TimelineItem {
  const track: TimelineItem["track"] =
    imp.source === "radar" ? "radar"
    : imp.source === "nws" ? "nws"
    : "road";
  return {
    id: imp.id,
    track,
    label: imp.driverHeadline,
    severity: imp.severity,
    startMeters: imp.startMeters,
    endMeters: imp.endMeters,
    detailLine: (imp.roadEffect || imp.detail || "").trim() || null,
    crossesRoute: true,
  };
}
