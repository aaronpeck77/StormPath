import { useMemo } from "react";

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
          <span className="route-storm-strip__title-text">{band.event}</span>
        </div>
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
