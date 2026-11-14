import { useMemo, type RefObject } from "react";
import type { CarConditionsInput } from "../services/carSessionPublish";
import { formatDistanceShort } from "../utils/formatDistance";
import { formatMinutesAsHoursMinutes } from "./formatEta";
import { SPEED_LIMIT_DISPLAY_ENABLED } from "../nav/postedSpeed";
import { formatRouteAlertTiming, isAlertExpired } from "../nav/routeAlertTiming";
import type { LngLat, RouteTurnStep } from "../nav/types";
import type { RouteAlert } from "../nav/routeAlerts";
import type { RouteChunkCalloutItem } from "../nav/routeProgressChunkList";
import type { WxSample } from "../nav/routeChunkWeather";
import type { RouteOutlookStep } from "../nav/routeForecastTimeline";
import type { TimelineItem } from "./RouteHazardTimeline";
import type { StormProgressBand } from "./RouteProgressStrip";
import type { StormAdvisoryBarProps } from "./StormAdvisoryBar";
import { RouteProgressGlancePanel } from "./RouteProgressGlancePanel";
import { RouteProgressStrip } from "./RouteProgressStrip";
import { AdvisoryExpandedSections } from "./AdvisoryExpandedSections";
import { useAdvisoryExpandedModel } from "./advisoryExpandedModel";

type RadarSample = { t: number; intensity: number };
type WindPoint = { t: number; mph: number };

/** Everything the real progress rail + weather graph need — same data the map view uses. */
export type CarPlayCompanionRail = {
  stripGeometry: LngLat[];
  userLngLat: LngLat | null;
  stripAlerts: RouteAlert[];
  radarIntensity: number;
  stripRouteColor: string;
  stripTurnSteps: RouteTurnStep[] | undefined;
  fallbackTurnSteps: RouteTurnStep[];
  stormBands: StormProgressBand[];
  radarSliceSamples: RadarSample[];
  radarSliceLoopFrames?: RadarSample[][];
  tripOdometerM: number;

  timeline: TimelineItem[];
  routeWide: RouteChunkCalloutItem[];
  outlookSteps: RouteOutlookStep[];
  outlookSamples: WxSample[] | undefined;
  radarMosaicSamples: RadarSample[];
  radarStatusNote: string | null;
  windPoints: WindPoint[];
  gustLinePoints: WindPoint[];
  gustSpikePoints: WindPoint[];
  fallbackSegments: RouteChunkCalloutItem[];
  planEtaMinutes: number | null;
  progressAlongM: number;
  railTotalMeters?: number;
  userAlongT: number;
  stripTint: string;
  detailScrollRef?: RefObject<HTMLDivElement | null>;
};

type Props = {
  destinationLabel: string | null;
  /** Live minutes-remaining estimate (same source the car sees). */
  etaMinutes: number | null;
  advisoryLine: string | null;
  /** Sourced posted limit only — null hides the chip. */
  speedLimitMph: number | null;
  conditions: CarConditionsInput;
  rail: CarPlayCompanionRail;
  /** Same prop bag the map-view advisory bar gets — drives the hazard/forecast sections. */
  advisory: StormAdvisoryBarProps;
  /** "SEVERITY · label" titles the CarPlay scene announced — highlight these on the phone. */
  carAlertedHazardTitles: string[];
  useMiles: boolean;
  onShowMap: () => void;
};

const SEVERITY_DOT: Record<string, string> = {
  AVOID: "#f87171",
  WARNING: "#f87171",
  CAUTION: "#fbbf24",
  ADVISORY: "#38bdf8",
  INFO: "#38bdf8",
};

function severityDot(title: string): string | null {
  const head = title.split("·")[0]?.trim().toUpperCase() ?? "";
  return SEVERITY_DOT[head] ?? null;
}

/** "WARNING · Flash Flood Warning" → "Flash Flood Warning". */
function hazardLabelFromTitle(title: string): string {
  const idx = title.indexOf("·");
  return (idx >= 0 ? title.slice(idx + 1) : title).trim();
}

/**
 * Phone companion page shown while CarPlay is driving.
 * The car screen owns guidance; this page is the detail view — the real
 * progress rail strip, the route weather graph, and the same advisory
 * content the map view shows, so the two never disagree.
 */
export function CarPlayCompanionView(p: Props) {
  const r = p.rail;
  const total = Math.max(0, p.conditions.totalMeters);
  const railTotal = Math.max(0, r.railTotalMeters ?? total);
  const along = Math.min(Math.max(0, p.conditions.userAlongMeters), total);
  const railAlong = Math.min(Math.max(0, r.progressAlongM), railTotal);
  const pct = railTotal > 0 ? railAlong / railTotal : (total > 0 ? along / total : 0);
  const remainingM = Math.max(0, total - along);
  const dist = formatDistanceShort(remainingM, p.useMiles);
  const arrive =
    p.etaMinutes != null && Number.isFinite(p.etaMinutes)
      ? new Date(Date.now() + p.etaMinutes * 60_000)
      : null;

  /* Arrival forecast — the corridor outlook's last step is destination-at-ETA,
   * distinct from the local "right now" forecast below. */
  const arrivalStep = useMemo(() => {
    const steps = p.conditions.outlook ?? [];
    if (!steps.length) return null;
    return [...steps].sort((a, b) => b.fraction - a.fraction)[0] ?? null;
  }, [p.conditions.outlook]);

  /* Advisory model + sections — identical derivation to the map view's
   * expanded advisory panel. barExpanded=true so the route hazard feed
   * shows while navigating, same as the open panel. */
  const advisoryProps = useMemo<StormAdvisoryBarProps>(
    () => ({ ...p.advisory, barExpanded: true }),
    [p.advisory]
  );
  const advisoryModel = useAdvisoryExpandedModel(advisoryProps);

  /* Hazards the car just announced — match the "SEVERITY · label" titles
   * back to route timeline items for timing/detail. */
  const carAlerted = useMemo(() => {
    if (p.carAlertedHazardTitles.length === 0) return [];
    return p.carAlertedHazardTitles.map((title) => {
      const label = hazardLabelFromTitle(title);
      const item = r.timeline.find(
        (t) =>
          !isAlertExpired(t.expiresIso) &&
          t.label.trim().toLowerCase() === label.toLowerCase()
      );
      const timing = item
        ? formatRouteAlertTiming({
            ...item,
            userAlongMeters: p.conditions.userAlongMeters,
            totalMeters: total,
            planEtaMinutes: r.planEtaMinutes,
            driveEtaMinutes: p.etaMinutes,
          })
        : null;
      return { title, label, item, timing };
    });
  }, [p.carAlertedHazardTitles, r.timeline, p.conditions.userAlongMeters, total, r.planEtaMinutes, p.etaMinutes]);

  return (
    <div className="cp-companion" role="region" aria-label="CarPlay companion">
      <header className="cp-companion__head">
        <span className="cp-companion__badge">CarPlay driving</span>
        <button type="button" className="cp-companion__mapbtn" onClick={p.onShowMap}>
          Map
        </button>
      </header>

      <section className="cp-companion__eta">
        <div className="cp-companion__dest">{p.destinationLabel || "Active trip"}</div>
        <div className="cp-companion__stats">
          <span>
            {p.etaMinutes != null
              ? p.etaMinutes >= 60
                ? formatMinutesAsHoursMinutes(Math.round(p.etaMinutes))
                : `${Math.max(0, Math.round(p.etaMinutes))} min`
              : "—"}
            {dist ? ` · ${dist} left` : ""}
          </span>
          {arrive ? (
            <span className="cp-companion__arrive">
              Arrive ~{arrive.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
            </span>
          ) : null}
        </div>
        {arrivalStep &&
        (arrivalStep.tempF != null || arrivalStep.conditions) ? (
          <div
            className="cp-companion__arrivewx"
            title="Forecast at your destination when you arrive"
          >
            {arrivalStep.icon ? `${arrivalStep.icon} ` : ""}
            {arrivalStep.conditions}
            {arrivalStep.tempF != null
              ? ` · ${Math.round(arrivalStep.tempF)}°`
              : ""}
            {arrivalStep.precipPct != null && arrivalStep.precipPct >= 20
              ? ` · ${Math.round(arrivalStep.precipPct)}% precip`
              : ""}
          </div>
        ) : null}
        {p.advisoryLine ? <p className="cp-companion__advisory">{p.advisoryLine}</p> : null}
        <div className="cp-companion__meta">
          {SPEED_LIMIT_DISPLAY_ENABLED && p.speedLimitMph != null && p.speedLimitMph > 0 ? (
            <span className="cp-companion__chip">{Math.round(p.speedLimitMph)} mph limit</span>
          ) : null}
          <span className="cp-companion__chip cp-companion__chip--dim">
            {Math.round(pct * 100)}% there
          </span>
        </div>
      </section>

      {/* The real progress rail, turned sideways for the page: route line,
       * turn ticks, storm bands, and the radar slice crossing the path. */}
      <div className="cp-companion__rail">
        <div className="cp-companion__rail-head">
          <span className="cp-companion__rail-title">Route progress</span>
          <span className="cp-companion__rail-sub">
            Where you are on the trip — turns, storms, and radar along the route.
          </span>
        </div>
        <RouteProgressStrip
          layout="fullBleed"
          geometry={r.stripGeometry}
          userLngLat={r.userLngLat}
          userAlongMeters={r.progressAlongM}
          alerts={r.stripAlerts}
          radarIntensity={r.radarIntensity}
          routeLineColor={r.stripRouteColor}
          turnSteps={r.stripTurnSteps ?? r.fallbackTurnSteps}
          stormBands={r.stormBands}
          radarSliceSamples={r.radarSliceSamples}
          radarSliceLoopFrames={r.radarSliceLoopFrames}
          driveEndsEmphasis
          tripOdometerM={r.tripOdometerM}
          tripRelativeProgress
        />
      </div>

      {/* Route weather graph — wind, radar, rain, temperature along the route. */}
      <div className="cp-companion__graph">
        <RouteProgressGlancePanel
          timeline={r.timeline}
          routeWide={r.routeWide}
          outlookSteps={r.outlookSteps}
          outlookSamples={r.outlookSamples}
          radarSamples={r.radarMosaicSamples}
          radarStatusNote={r.radarStatusNote}
          windPoints={r.windPoints}
          gustLinePoints={r.gustLinePoints}
          gustSpikePoints={r.gustSpikePoints}
          fallbackSegments={r.fallbackSegments}
          totalMeters={total}
          userAlongMeters={r.progressAlongM}
          planEtaMinutes={r.planEtaMinutes}
          driveEtaMinutes={p.etaMinutes}
          userAlongT={r.userAlongT}
          stripTint={r.stripTint}
          detailScrollRef={r.detailScrollRef}
        />
      </div>

      {carAlerted.length > 0 ? (
        <section className="cp-companion__caralert" aria-label="Hazards announced on CarPlay">
          <div className="cp-companion__caralert-head">
            <span className="cp-companion__caralert-pill">CarPlay alert</span>
            <span className="cp-companion__caralert-sub">
              The car screen flagged these — details below
            </span>
          </div>
          <ul className="cp-companion__caralert-list">
            {carAlerted.map((h) => {
              const dot = severityDot(h.title);
              return (
                <li key={h.title} className="cp-companion__caralert-item">
                  <span
                    className="cp-companion__dot"
                    style={dot ? { background: dot } : undefined}
                    aria-hidden
                  />
                  <div className="cp-companion__itembody">
                    <div className="cp-companion__itemtitle">{h.label}</div>
                    <div className="cp-companion__itemdetail">
                      {h.item?.detailLine ?? h.title}
                      {h.timing?.timingLine ? ` · ${h.timing.timingLine}` : ""}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* The same advisory content the map view shows: local forecast
       * (Now / 24-hour / 7-day) and route weather + road hazards. */}
      {p.advisory.featureEnabled ? (
        <div className="cp-companion__detail">
          <AdvisoryExpandedSections p={advisoryProps} model={advisoryModel} />
        </div>
      ) : null}
    </div>
  );
}
