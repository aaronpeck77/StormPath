import { useMemo } from "react";
import type { RouteImpact } from "../nav/routeImpacts";

/**
 * Severe-class NWS warning that crosses the active route, projected onto a horizontal
 * "you → destination" timeline. One strip is rendered per band; multiple stack vertically.
 *
 * Coordinates are along-meters (start / end of the polygon overlap on the route polyline).
 * The component converts them to viewport-relative percentages and computes ETA-ahead from
 * the user's current along position + the route's plan ETA.
 */
export type RouteStormStripBand = {
  id: string;
  /** "Severe Thunderstorm Warning", "Tornado Warning", etc. */
  event: string;
  /** RouteImpact severity. `serious` → orange, `avoid` → red. */
  severity: "info" | "caution" | "serious" | "avoid";
  /** Polygon overlap start along the active route (m). */
  startMeters: number;
  /** Polygon overlap end (m). */
  endMeters: number;
  /** Optional NWS expiration ISO. Surfaced in the caption when present. */
  expiresIso?: string | null;
  /** Optional NWS severity label (e.g. "Moderate", "Severe"). Shown below the event name. */
  severityLabel?: string | null;
  /** Optional one-line description / glance summary from NWS headline. Merged into the card. */
  detail?: string | null;
  /**
   * When false the polygon is near the route (within NWS corridor buffer) but the route line
   * doesn't actually cross it — shown as "Nearby" instead of precise enter/exit timing.
   */
  crossesRoute?: boolean;
  /** Tap target — usually opens the source NWS card. */
  onClick?: () => void;
};

export type RouteStormStripProps = {
  band: RouteStormStripBand;
  /** Total length of the active route (m). */
  totalMeters: number;
  /** User's current along-route position (m). */
  userAlongMeters: number;
  /** Plan ETA for the active route (min) — used for proportional minute estimates. */
  planEtaMinutes: number | null;
  /** Drive ETA (min, from current position) — preferred over plan when navigating. */
  driveEtaMinutes?: number | null;
};

const METERS_PER_MILE = 1609.34;

function formatMiles(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return "0 mi";
  const mi = meters / METERS_PER_MILE;
  return mi < 10 ? `${mi.toFixed(1)} mi` : `${Math.round(mi)} mi`;
}

function formatMinutesShort(min: number | null | undefined): string | null {
  if (min == null || !Number.isFinite(min) || min < 0) return null;
  if (min < 1) return "now";
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min - h * 60);
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

function formatExpires(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Convert along-meters to a 0..100 percentage relative to the *full* route length.
 * Clamped so a band that extends past the destination still renders at the right edge.
 */
function alongPct(alongM: number, totalM: number): number {
  if (totalM <= 0) return 0;
  return Math.max(0, Math.min(100, (alongM / totalM) * 100));
}

/* ─────────────────────────────────────────────────────────────────────────
 * RouteAlertGroupPanel — one combined panel card for ALL route-area alerts.
 *
 * Multiple NWS products that relate to the same storm event (e.g. Flood
 * Advisory + Special Weather Statement) are shown together: each alert gets
 * its own row with event name, severity pill, glance description, and a
 * mini progress rail showing where on the route it sits.  A single "YOU"
 * dot appears on every rail at the same position so you can compare the
 * bands at a glance.
 * ───────────────────────────────────────────────────────────────────────── */

export type RouteAlertGroupPanelProps = {
  bands: RouteStormStripBand[];
  totalMeters: number;
  userAlongMeters: number;
  planEtaMinutes: number | null;
  driveEtaMinutes?: number | null;
};

/** Derive per-alert visual values (rail percentages + timing text). */
function useAlertVisual(
  band: RouteStormStripBand,
  totalMeters: number,
  userAlongMeters: number,
  planEtaMinutes: number | null,
  driveEtaMinutes: number | null | undefined
) {
  return useMemo(() => {
    const remainingM = Math.max(0, totalMeters - userAlongMeters);
    const effectiveEtaMin =
      driveEtaMinutes != null && Number.isFinite(driveEtaMinutes)
        ? driveEtaMinutes
        : planEtaMinutes != null && Number.isFinite(planEtaMinutes) && totalMeters > 0
          ? planEtaMinutes * (remainingM / totalMeters)
          : null;

    const minutesAhead = (m: number): number | null => {
      if (effectiveEtaMin == null || remainingM <= 0) return null;
      const ahead = Math.max(0, m - userAlongMeters);
      if (ahead <= 0) return 0;
      return effectiveEtaMin * (ahead / remainingM);
    };

    const youPct = alongPct(userAlongMeters, totalMeters);
    const startPct = alongPct(band.startMeters, totalMeters);
    const endPct = alongPct(band.endMeters, totalMeters);
    const widthPct = Math.max(2, endPct - startPct);

    const enterMin = minutesAhead(band.startMeters);
    const exitMin = minutesAhead(band.endMeters);
    const lengthMi = formatMiles(Math.max(0, band.endMeters - band.startMeters));
    const passed = band.endMeters <= userAlongMeters;
    const inside = userAlongMeters >= band.startMeters && userAlongMeters < band.endMeters;

    return { youPct, startPct, widthPct, enterMin, exitMin, lengthMi, passed, inside };
  }, [band, totalMeters, userAlongMeters, planEtaMinutes, driveEtaMinutes]);
}

function AlertGroupItem({
  band,
  totalMeters,
  userAlongMeters,
  planEtaMinutes,
  driveEtaMinutes,
}: {
  band: RouteStormStripBand;
  totalMeters: number;
  userAlongMeters: number;
  planEtaMinutes: number | null;
  driveEtaMinutes?: number | null;
}) {
  const v = useAlertVisual(band, totalMeters, userAlongMeters, planEtaMinutes, driveEtaMinutes);
  const expiresLabel = formatExpires(band.expiresIso ?? null);
  const enterLabel = formatMinutesShort(v.enterMin);
  const exitLabel = formatMinutesShort(v.exitMin);

  const crosses = band.crossesRoute !== false; // default true
  const timing = crosses
    ? v.passed
      ? "Passed"
      : v.inside
        ? `In zone now · exits in ${exitLabel ?? "—"}`
        : enterLabel
          ? `Enter in ${enterLabel} · ${v.lengthMi} long`
          : `${v.lengthMi} long`
    : "Nearby — within storm corridor";

  const sevColors: Record<string, string> = {
    avoid: "#ef4444",
    serious: "#f97316",
    caution: "#eab308",
    info: "#60a5fa",
  };
  const sevColor = sevColors[band.severity] ?? "#94a3b8";

  return (
    <div
      className={`route-alert-group__item${v.passed ? " route-alert-group__item--passed" : ""}`}
      role={band.onClick ? "button" : undefined}
      tabIndex={band.onClick ? 0 : undefined}
      onClick={band.onClick}
      onKeyDown={band.onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); band.onClick?.(); } } : undefined}
      aria-label={band.onClick ? `${band.event} — open details` : undefined}
    >
      {/* Event name + severity pill */}
      <div className="route-alert-group__item-name">
        <span className="route-alert-group__item-icon" aria-hidden>⚠</span>
        <span className="route-alert-group__item-event">{band.event}</span>
        {band.severityLabel ? (
          <span className="route-alert-group__item-sev" style={{ borderColor: sevColor, color: sevColor }}>
            {band.severityLabel}
          </span>
        ) : null}
      </div>
      {/* Glance description */}
      {band.detail ? (
        <p className="route-alert-group__item-detail">{band.detail}</p>
      ) : null}
      {/* Mini progress rail */}
      <div className="route-alert-group__item-rail" role="img" aria-label={`${band.event} on route`}>
        <div className="route-alert-group__rail-track" />
        <div
          className={`route-alert-group__rail-band route-alert-group__rail-band--${band.severity}`}
          style={{ left: `${v.startPct}%`, width: `${v.widthPct}%` }}
        />
        <div
          className="route-alert-group__rail-you"
          style={{ left: `${v.youPct}%` }}
          title="You are here"
        />
        <div className="route-alert-group__rail-endmarks">
          <span className="route-alert-group__rail-endmark route-alert-group__rail-endmark--start">YOU</span>
          <span className="route-alert-group__rail-endmark route-alert-group__rail-endmark--end">DEST</span>
        </div>
      </div>
      {/* Timing */}
      <div className="route-alert-group__item-timing">
        {timing}
        {expiresLabel ? <span className="route-alert-group__item-expires"> · expires {expiresLabel}</span> : null}
      </div>
    </div>
  );
}

export function RouteAlertGroupPanel({
  bands,
  totalMeters,
  userAlongMeters,
  planEtaMinutes,
  driveEtaMinutes = null,
}: RouteAlertGroupPanelProps) {
  if (!bands.length) return null;

  /* Worst severity across all bands — drives the card's accent colour. */
  const worstSev = bands.reduce<RouteStormStripBand["severity"]>((acc, b) => {
    const rank = { avoid: 4, serious: 3, caution: 2, info: 1 } as const;
    return (rank[b.severity] ?? 1) > (rank[acc] ?? 1) ? b.severity : acc;
  }, "info");

  const sevClass = `route-alert-group--sev-${worstSev}`;

  return (
    <div className={`route-alert-group ${sevClass}`}>
      {/* Group header */}
      <div className="route-alert-group__header">
        <span className="route-alert-group__header-label">
          {bands.length === 1 ? "NWS alert on your route" : `NWS — ${bands.length} alerts on your route`}
        </span>
        <span className="route-alert-group__header-source">NWS</span>
      </div>

      {/* One row per alert */}
      {bands.map((band, i) => (
        <div key={band.id}>
          {i > 0 && <hr className="route-alert-group__divider" aria-hidden />}
          <AlertGroupItem
            band={band}
            totalMeters={totalMeters}
            userAlongMeters={userAlongMeters}
            planEtaMinutes={planEtaMinutes}
            driveEtaMinutes={driveEtaMinutes}
          />
        </div>
      ))}

      <p className="route-alert-group__footer">Source: National Weather Service</p>
    </div>
  );
}

export function RouteStormStrip({
  band,
  totalMeters,
  userAlongMeters,
  planEtaMinutes,
  driveEtaMinutes = null,
}: RouteStormStripProps) {
  const visual = useMemo(() => {
    /* Effective ETA reference: drive ETA (from user) when available, else plan ETA scaled by remaining. */
    const remainingM = Math.max(0, totalMeters - userAlongMeters);
    const effectiveTotalEtaMin =
      driveEtaMinutes != null && Number.isFinite(driveEtaMinutes)
        ? driveEtaMinutes
        : planEtaMinutes != null && Number.isFinite(planEtaMinutes) && totalMeters > 0
          ? planEtaMinutes * (remainingM / totalMeters)
          : null;
    const minutesAtMeters = (m: number): number | null => {
      if (effectiveTotalEtaMin == null || remainingM <= 0) return null;
      const aheadM = Math.max(0, m - userAlongMeters);
      if (aheadM <= 0) return 0;
      return effectiveTotalEtaMin * (aheadM / remainingM);
    };

    const youPct = alongPct(userAlongMeters, totalMeters);
    const startPct = alongPct(band.startMeters, totalMeters);
    const endPct = alongPct(band.endMeters, totalMeters);
    const widthPct = Math.max(1.5, endPct - startPct);

    const enterMin = minutesAtMeters(band.startMeters);
    const exitMin = minutesAtMeters(band.endMeters);
    const lengthMi = formatMiles(Math.max(0, band.endMeters - band.startMeters));

    const passed = band.endMeters <= userAlongMeters;
    const inside = userAlongMeters >= band.startMeters && userAlongMeters < band.endMeters;

    return {
      youPct,
      startPct,
      widthPct,
      enterMin,
      exitMin,
      lengthMi,
      passed,
      inside,
    };
  }, [band, totalMeters, userAlongMeters, planEtaMinutes, driveEtaMinutes]);

  const expiresLabel = formatExpires(band.expiresIso ?? null);
  const enterLabel = formatMinutesShort(visual.enterMin);
  const exitLabel = formatMinutesShort(visual.exitMin);

  /* Tone the caption to match the user's relationship to the band. */
  const captionPrimary = visual.passed
    ? "Storm passed"
    : visual.inside
      ? `In storm now · exits in ${exitLabel ?? "—"}`
      : enterLabel
        ? `Enter in ${enterLabel} · ${visual.lengthMi} long${exitLabel ? ` · exit in ${exitLabel}` : ""}`
        : `${visual.lengthMi} long`;

  const captionSecondary = expiresLabel
    ? `Source: NWS · expires ${expiresLabel}`
    : "Source: NWS";

  const sevClass =
    band.severity === "avoid"
      ? "route-storm-strip--sev-avoid"
      : band.severity === "serious"
        ? "route-storm-strip--sev-serious"
        : "route-storm-strip--sev-caution";

  return (
    <div className={`route-storm-strip ${sevClass}${visual.passed ? " route-storm-strip--passed" : ""}`}>
      <button
        type="button"
        className="route-storm-strip__btn"
        onClick={band.onClick}
        title={`${band.event} — open details`}
        aria-label={`${band.event}, ${captionPrimary}`}
      >
        <div className="route-storm-strip__title">
          <span className="route-storm-strip__icon" aria-hidden>
            ⚠
          </span>
          <span className="route-storm-strip__title-text">
            {band.event}
            {band.severityLabel ? (
              <span className="route-storm-strip__sev-label">{band.severityLabel}</span>
            ) : null}
          </span>
        </div>
        {band.detail ? (
          <p className="route-storm-strip__detail">{band.detail}</p>
        ) : null}
        <div className="route-storm-strip__rail" role="img" aria-hidden>
          <div className="route-storm-strip__track" />
          <div
            className="route-storm-strip__band"
            style={{ left: `${visual.startPct}%`, width: `${visual.widthPct}%` }}
          />
          <div
            className="route-storm-strip__you"
            style={{ left: `${visual.youPct}%` }}
            title="You are here"
          />
          <div className="route-storm-strip__endmarks">
            <span className="route-storm-strip__endmark route-storm-strip__endmark--start">YOU</span>
            <span className="route-storm-strip__endmark route-storm-strip__endmark--end">DEST</span>
          </div>
        </div>
        <div className="route-storm-strip__caption">
          <span className="route-storm-strip__caption-primary">{captionPrimary}</span>
          <span className="route-storm-strip__caption-secondary">{captionSecondary}</span>
        </div>
      </button>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * RouteImpactGroupPanel — compact progress-bar panel for radar and road
 * hazard RouteImpact items.  Each item gets its own mini rail showing its
 * position along the route relative to YOU and DEST.
 *
 * Point impacts (traffic jams, closures, incidents) have startMeters ===
 * endMeters; we show a minimum-width marker band so they are visible.
 * ───────────────────────────────────────────────────────────────────────── */

const IMPACT_SOURCE_ICON: Record<string, string> = {
  radar: "🌧",
  mapboxTraffic: "🚗",
  mapboxIncident: "⚠",
  routeNotice: "🔶",
  fused: "⚠",
  nws: "⚡",
};

const IMPACT_CATEGORY_ICON: Record<string, string> = {
  traffic: "🚗",
  closure: "🚫",
  incident: "⚠",
  construction: "🔶",
  weather: "🌧",
  flooding: "💧",
  winter: "❄",
  wind: "💨",
  visibility: "🌫",
};

function impactIcon(impact: RouteImpact): string {
  return IMPACT_CATEGORY_ICON[impact.category] ?? IMPACT_SOURCE_ICON[impact.source] ?? "⚠";
}

export type RouteImpactGroupPanelProps = {
  label: string;
  impacts: RouteImpact[];
  totalMeters: number;
  userAlongMeters: number;
  planEtaMinutes: number | null;
  driveEtaMinutes?: number | null;
  /** "radar" | "road" — controls accent color. */
  kind: "radar" | "road";
  onImpactClick?: (impact: RouteImpact) => void;
};

/** Minimum visual band width as a % of the full route (so point impacts are visible). */
const MIN_BAND_PCT = 2.5;

export function RouteImpactGroupPanel({
  label,
  impacts,
  totalMeters,
  userAlongMeters,
  planEtaMinutes,
  driveEtaMinutes = null,
  kind,
  onImpactClick,
}: RouteImpactGroupPanelProps) {
  if (!impacts.length || totalMeters <= 0) return null;

  const worstSev = impacts.reduce<RouteImpact["severity"]>((acc, imp) => {
    const rank = { avoid: 4, serious: 3, caution: 2, info: 1 } as const;
    return (rank[imp.severity] ?? 1) > (rank[acc] ?? 1) ? imp.severity : acc;
  }, "info");

  const remainingM = Math.max(0, totalMeters - userAlongMeters);
  const effectiveEtaMin =
    driveEtaMinutes != null && Number.isFinite(driveEtaMinutes)
      ? driveEtaMinutes
      : planEtaMinutes != null && Number.isFinite(planEtaMinutes) && totalMeters > 0
        ? planEtaMinutes * (remainingM / totalMeters)
        : null;

  const youPct = alongPct(userAlongMeters, totalMeters);

  return (
    <div className={`route-impact-group route-impact-group--${kind} route-impact-group--sev-${worstSev}`}>
      <div className="route-impact-group__header">
        <span className="route-impact-group__header-label">{label}</span>
        {impacts.length > 1 && (
          <span className="route-impact-group__header-count">{impacts.length}</span>
        )}
      </div>

      {impacts.map((imp, i) => {
        const startPct = alongPct(imp.startMeters, totalMeters);
        const rawEndPct = alongPct(imp.endMeters, totalMeters);
        const widthPct = Math.max(MIN_BAND_PCT, rawEndPct - startPct);

        const aheadM = imp.distanceAheadMeters;
        const eta = imp.etaAheadMinutes ?? (
          aheadM != null && effectiveEtaMin != null && remainingM > 0
            ? effectiveEtaMin * (aheadM / remainingM)
            : null
        );

        const insideNow = aheadM != null && aheadM <= 100;
        const passed = imp.endMeters <= userAlongMeters && !insideNow;

        const aheadLabel = insideNow
          ? "Now — on your path"
          : aheadM != null && Number.isFinite(aheadM)
            ? aheadM < 1609 ? `${Math.round(aheadM / 100) * 100} ft ahead`
              : aheadM < 16090 ? `${(aheadM / 1609.34).toFixed(1)} mi ahead`
                : `${Math.round(aheadM / 1609.34)} mi ahead`
            : null;

        const etaLabel = eta != null && Number.isFinite(eta) && eta >= 0.5
          ? eta < 60 ? `${Math.round(eta)} min` : `${Math.floor(eta / 60)}h ${Math.round(eta % 60)}m`
          : null;

        const timing = passed ? "Behind you"
          : [aheadLabel, etaLabel && `≈ ${etaLabel}`].filter(Boolean).join(" · ");

        const icon = impactIcon(imp);

        return (
          <div key={imp.id}>
            {i > 0 && <hr className="route-impact-group__divider" aria-hidden />}
            <div
              className={`route-impact-group__item route-impact-group__item--sev-${imp.severity}${passed ? " route-impact-group__item--passed" : ""}${onImpactClick ? " route-impact-group__item--tappable" : ""}`}
              role={onImpactClick ? "button" : undefined}
              tabIndex={onImpactClick ? 0 : undefined}
              onClick={onImpactClick ? () => onImpactClick(imp) : undefined}
              onKeyDown={onImpactClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onImpactClick(imp); } } : undefined}
            >
              <div className="route-impact-group__item-name">
                <span className="route-impact-group__item-icon" aria-hidden>{icon}</span>
                <span className="route-impact-group__item-headline">{imp.driverHeadline}</span>
              </div>
              {(imp.roadEffect || imp.detail) ? (
                <p className="route-impact-group__item-detail">
                  {imp.roadEffect || imp.detail}
                </p>
              ) : null}
              {/* Mini rail */}
              <div className="route-impact-group__rail" role="img">
                <div className="route-impact-group__rail-track" />
                <div
                  className={`route-impact-group__rail-band route-impact-group__rail-band--${imp.severity}`}
                  style={{ left: `${startPct}%`, width: `${widthPct}%` }}
                />
                <div
                  className="route-impact-group__rail-you"
                  style={{ left: `${youPct}%` }}
                />
                <div className="route-impact-group__rail-endmarks">
                  <span className="route-impact-group__rail-endmark route-impact-group__rail-endmark--start">YOU</span>
                  <span className="route-impact-group__rail-endmark route-impact-group__rail-endmark--end">DEST</span>
                </div>
              </div>
              {timing ? (
                <div className="route-impact-group__item-timing">{timing}</div>
              ) : null}
            </div>
          </div>
        );
      })}

      <p className="route-impact-group__footer">
        {kind === "radar" ? "Source: Radar" : "Source: Mapbox traffic · road reports"}
      </p>
    </div>
  );
}
