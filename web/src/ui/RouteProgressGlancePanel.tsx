import { useEffect, useMemo, useRef, type CSSProperties, type RefObject } from "react";
import type { RouteChunkCalloutItem } from "../nav/routeProgressChunkList";
import type { WxSample } from "../nav/routeChunkWeather";
import type { RouteOutlookStep } from "../nav/routeForecastTimeline";
import {
  buildRouteAheadGlanceCards,
  timelineItemBandColor,
  timelineItemShowsOnRouteGraph,
  type RouteAheadGlanceCard,
  type RouteAheadRelevance,
} from "../nav/routeAheadSync";
import type { TimelineItem } from "./RouteHazardTimeline";
import type { LngLat } from "../nav/types";
import { buildRouteChartNightBands, buildRouteNightTransitions } from "../forecast/chartNightBands";
import {
  buildRouteSunEvents,
  routeSunEventAxisLabel,
} from "../forecast/routeSunEvents";
import { useMilesForLngLat } from "../utils/formatDistance";
import { RouteInfoLegend } from "./RouteInfoLegend";
import { RouteNightAxisOverlay, type NightAxisLabel } from "./RouteNightAxisOverlay";
import { RouteOutlookTimeline } from "./RouteOutlookTimeline";
import { RouteRadarWindStrip } from "./RouteRadarWindStrip";
import {
  computeRouteAxisMinWidth,
  ROUTE_PLOT_INSET_START,
  routePlotLeftPct,
  routePlotWidthPct,
} from "./routeAxisLayout";
import { routeWindGraphVisible } from "../nav/windForecastCalib";
import type { StormCorridorIntersectResult } from "../features/stormCorridorIntersect";
import { RouteStormIntersectOverlay } from "./RouteStormIntersectOverlay";

type Props = {
  timeline: TimelineItem[];
  routeWide: RouteChunkCalloutItem[];
  outlookSteps: RouteOutlookStep[];
  outlookSamples?: WxSample[];
  /** RainViewer mosaic samples for the radar intensity strata */
  radarSamples?: { t: number; intensity: number }[];
  /** Wind gust points from TIO forecast intervals (t=0–1 along route, mph) */
  windPoints?: { t: number; mph: number }[];
  gustSpikePoints?: { t: number; mph: number }[];
  fallbackSegments: RouteChunkCalloutItem[];
  totalMeters: number;
  userAlongMeters: number;
  planEtaMinutes: number | null;
  driveEtaMinutes?: number | null;
  userAlongT: number;
  stripTint: string;
  geometry?: LngLat[] | null;
  /** Experimental radar-intersect overlay (null when feature off). */
  stormCorridorIntersect?: StormCorridorIntersectResult | null;
  /** Parent scrolls this region vertically (alert list only). */
  detailScrollRef?: RefObject<HTMLDivElement | null>;
};

const TRACK_BADGE: Record<TimelineItem["track"], string> = {
  nws: "NWS",
  radar: "RAD",
  wind: "WIND",
  forecast: "FCST",
  road: "RD",
};

const RELEVANCE_LABEL: Record<RouteAheadRelevance, string> = {
  active: "Still on",
  ending: "Ending",
  clear: "Clearing",
};

const MIN_BAND_PCT = 1.4;
const MAX_GLANCE_CARDS = 6;

type HazardBandVisual = {
  id: string;
  track: TimelineItem["track"];
  label: string;
  left: number;
  width: number;
  color: string;
  severity: TimelineItem["severity"];
  nearby: boolean;
  muted: boolean;
};

const HAZARD_RAIL_META: Record<
  TimelineItem["track"],
  { label: string; sublabelClass: string; railClass: string; bandClass: string }
> = {
  nws: {
    label: "NWS",
    sublabelClass: "rpgl__hazard-sublabel--nws",
    railClass: "rpgl__hazard-rail--nws",
    bandClass: "rpgl__band--nws",
  },
  radar: {
    label: "Radar",
    sublabelClass: "rpgl__hazard-sublabel--radar",
    railClass: "rpgl__hazard-rail--radar",
    bandClass: "rpgl__band--radar",
  },
  wind: {
    label: "Wind",
    sublabelClass: "rpgl__hazard-sublabel--wind",
    railClass: "rpgl__hazard-rail--wind",
    bandClass: "rpgl__band--wind",
  },
  forecast: {
    label: "Forecast",
    sublabelClass: "rpgl__hazard-sublabel--forecast",
    railClass: "rpgl__hazard-rail--forecast",
    bandClass: "rpgl__band--forecast",
  },
  road: {
    label: "Road",
    sublabelClass: "rpgl__hazard-sublabel--road",
    railClass: "rpgl__hazard-rail--road",
    bandClass: "rpgl__band--road",
  },
};

const HAZARD_RAIL_ORDER: TimelineItem["track"][] = ["nws", "road"]; // radar → strata, wind → graph

function HazardRailRow({ track, bands }: { track: TimelineItem["track"]; bands: HazardBandVisual[] }) {
  const meta = HAZARD_RAIL_META[track];
  const emptyHint =
    track === "nws" ? "No NWS on route"
    : track === "road" ? "No road hazards"
    : "Clear";
  return (
    <div className="rpgl__hazard-row">
      <span className={`rpgl__hazard-sublabel ${meta.sublabelClass}`}>{meta.label}</span>
      <div
        className={`rpgl__hazard-rail ${meta.railClass}${bands.length ? "" : " rpgl__hazard-rail--empty"}`}
      >
        {bands.map((band) => (
          <span
            key={band.id}
            className={`rpgl__band ${meta.bandClass} rpgl__band--${band.severity}${band.nearby ? " rpgl__band--nearby" : ""}${band.muted ? " rpgl__band--muted" : ""}`}
            style={{
              left: `${band.left}%`,
              width: `${band.width}%`,
              backgroundColor: band.color,
            }}
            title={band.label}
          />
        ))}
        {!bands.length ? (
          <span className="rpgl__hazard-empty">{emptyHint}</span>
        ) : null}
      </div>
    </div>
  );
}

function GlanceCard({
  card,
  scrollRef,
}: {
  card: RouteAheadGlanceCard;
  scrollRef?: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={scrollRef}
      className={`rpgl__card${card.inside ? " rpgl__card--current" : ""}`}
      role="listitem"
      title={card.tooltip}
      aria-current={card.inside ? "true" : undefined}
    >
      <span className="rpgl__card-accent" style={{ backgroundColor: card.color }} aria-hidden />
      <div className="rpgl__card-body">
        <div className="rpgl__card-head">
          <span className={`rpgl__track rpgl__track--${card.track}`}>{TRACK_BADGE[card.track]}</span>
          <span className={`rpgl__label rpgl__label--${card.severity}`}>{card.label}</span>
        </div>
        <p
          className={`rpgl__ahead${card.inside ? " rpgl__ahead--now" : ""}`}
          aria-label={`Distance along route: ${card.aheadLabel}`}
        >
          {card.aheadLabel}
        </p>
        {card.detailLine ? <p className="rpgl__detail">{card.detailLine}</p> : null}
        <div className="rpgl__chips" aria-hidden>
          {card.etaLabel ? <span className="rpgl__chip rpgl__chip--eta">{card.etaLabel}</span> : null}
          {card.relevance ? (
            <span className={`rpgl__chip rpgl__chip--rel rpgl__chip--rel-${card.relevance}`}>
              {RELEVANCE_LABEL[card.relevance]}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function isInsideSegment(item: RouteChunkCalloutItem, userAlongMeters: number): boolean {
  const start = item.segmentStartM;
  const end = item.segmentEndM;
  if (start == null || end == null || !Number.isFinite(start) || !Number.isFinite(end)) return false;
  return userAlongMeters >= start && userAlongMeters < end;
}

function FallbackCard({
  item,
  userAlongMeters,
  scrollRef,
}: {
  item: RouteChunkCalloutItem;
  userAlongMeters: number;
  scrollRef?: RefObject<HTMLDivElement | null>;
}) {
  const shortTitle = item.title.replace(/^(NWS|Radar|Forecast|Road)\s*·\s*/i, "");
  const inside = isInsideSegment(item, userAlongMeters);
  return (
    <div
      ref={scrollRef}
      className={`rpgl__card rpgl__card--fallback${inside ? " rpgl__card--current" : ""}`}
      role="listitem"
      title={item.tooltip}
      aria-current={inside ? "true" : undefined}
    >
      <span className="rpgl__card-accent" style={{ backgroundColor: item.color }} aria-hidden />
      <div className="rpgl__card-body">
        <span className="rpgl__label">{shortTitle}</span>
        {item.summary ? <p className="rpgl__detail">{item.summary}</p> : null}
        <div className="rpgl__chips" aria-hidden>
          <span className="rpgl__chip rpgl__chip--dist">{item.alongPct}%</span>
        </div>
      </div>
    </div>
  );
}

export function RouteProgressGlancePanel({
  timeline,
  routeWide,
  outlookSteps,
  outlookSamples,
  radarSamples = [],
  windPoints = [],
  gustSpikePoints = [],
  fallbackSegments,
  totalMeters,
  userAlongMeters,
  planEtaMinutes,
  driveEtaMinutes = null,
  userAlongT,
  stripTint,
  geometry = null,
  stormCorridorIntersect = null,
  detailScrollRef,
}: Props) {
  const glanceCards = useMemo(
    () =>
      buildRouteAheadGlanceCards({
        items: timeline,
        totalMeters,
        userAlongMeters,
        planEtaMinutes,
        driveEtaMinutes,
      }),
    [timeline, totalMeters, userAlongMeters, planEtaMinutes, driveEtaMinutes]
  );

  const nightBands = useMemo(
    () =>
      geometry && geometry.length >= 2 && totalMeters > 0
        ? buildRouteChartNightBands({
            geometry,
            totalMeters,
            userAlongMeters,
            planEtaMinutes,
            driveEtaMinutes,
          })
        : [],
    [geometry, totalMeters, userAlongMeters, planEtaMinutes, driveEtaMinutes]
  );

  const nightTransitions = useMemo(
    () =>
      geometry && geometry.length >= 2 && totalMeters > 0
        ? buildRouteNightTransitions({
            geometry,
            totalMeters,
            userAlongMeters,
            planEtaMinutes,
            driveEtaMinutes,
          })
        : [],
    [geometry, totalMeters, userAlongMeters, planEtaMinutes, driveEtaMinutes]
  );

  const routeSunEvents = useMemo(
    () =>
      geometry && geometry.length >= 2 && totalMeters > 0
        ? buildRouteSunEvents({
            geometry,
            totalMeters,
            userAlongMeters,
            planEtaMinutes,
            driveEtaMinutes,
          })
        : [],
    [geometry, totalMeters, userAlongMeters, planEtaMinutes, driveEtaMinutes]
  );

  const useMiles = useMilesForLngLat(geometry?.[0] ?? null);

  const nightAxisLabels = useMemo((): NightAxisLabel[] => {
    if (!geometry || geometry.length < 2 || totalMeters <= 0) return [];
    const labels: NightAxisLabel[] = [];

    routeSunEvents.forEach((event, index) => {
      const { title, time, place } = routeSunEventAxisLabel(event, userAlongMeters, useMiles);
      labels.push({
        fraction: event.fraction,
        kind: event.kind,
        title,
        time,
        place,
        stagger: index % 2 === 1 ? "bottom" : "top",
      });
    });

    const nightFromStart =
      nightBands.some((b) => b.start <= 0.02) &&
      !routeSunEvents.some((e) => e.kind === "sunset" && e.fraction < 0.06);
    if (nightFromStart) {
      labels.unshift({
        fraction: 0,
        kind: "night-now",
        title: "Night",
        time: "Now",
        place: "On route",
        stagger: "top",
      });
    }

    return labels;
  }, [geometry, totalMeters, userAlongMeters, useMiles, nightBands, routeSunEvents]);

  const showNightAxis = nightBands.length > 0 || routeSunEvents.length > 0;

  const bandVisuals = useMemo((): HazardBandVisual[] => {
    if (totalMeters <= 0) return [];
    return timeline
      .filter((item) => timelineItemShowsOnRouteGraph(item) && item.endMeters > userAlongMeters)
      .map((item) => {
        const startF = item.startMeters / totalMeters;
        const endF = item.endMeters / totalMeters;
        return {
          id: item.id,
          track: item.track,
          label: item.label,
          left: routePlotLeftPct(startF),
          width: Math.max(MIN_BAND_PCT, routePlotWidthPct(startF, endF)),
          color: timelineItemBandColor(item),
          severity: item.severity,
          nearby: item.crossesRoute === false,
          muted: Boolean(item.stripMuted),
        };
      });
  }, [timeline, totalMeters, userAlongMeters]);

  const bandsByTrack = useMemo(() => {
    const map: Record<TimelineItem["track"], HazardBandVisual[]> = {
      nws: [],
      radar: [],
      wind: [],
      forecast: [],
      road: [],
    };
    for (const band of bandVisuals) {
      map[band.track].push(band);
    }
    return map;
  }, [bandVisuals]);

  const tickSteps = useMemo(
    () => [...outlookSteps].sort((a, b) => a.fraction - b.fraction),
    [outlookSteps]
  );

  const visibleCards = glanceCards.slice(0, MAX_GLANCE_CARDS);
  const overflow = glanceCards.length - visibleCards.length;
  const activeScrollCardId = useMemo(() => {
    const inside = visibleCards.filter((c) => c.inside);
    return inside[0]?.id ?? null;
  }, [visibleCards, userAlongMeters]);
  const activeCardScrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!activeScrollCardId) return;
    activeCardScrollRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeScrollCardId]);
  const driverLeftPct = routePlotLeftPct(userAlongT);
  const showAxis = outlookSteps.length > 0 || bandVisuals.length > 0 || totalMeters > 0;
  const plotLabelInsetStyle = {
    paddingLeft: `${ROUTE_PLOT_INSET_START * 100}%`,
  } as CSSProperties;

  const axisMinWidth = useMemo(
    () =>
      computeRouteAxisMinWidth({
        totalMeters,
        planEtaMinutes,
        outlookStepCount: outlookSteps.length,
        bandCount: bandVisuals.length,
      }),
    [totalMeters, planEtaMinutes, outlookSteps.length, bandVisuals.length]
  );

  const hasDetail =
    routeWide.length > 0 || visibleCards.length > 0 || fallbackSegments.length > 0;

  return (
    <div className="rpgl">
      <RouteInfoLegend />
      {showAxis ? (
        <div className="rpgl__axis-pane">
          <div className="rpgl__axis-scroll" aria-label="Route outlook and hazards along your trip">
            <div className="rpgl__axis-inner" style={{ minWidth: axisMinWidth }}>
              <div className="rpgl__sync-stack">
                <div className="rpgl__sync-head">
                  <span className="rpgl__sync-head-you">YOU</span>
                  <span className="rpgl__sync-head-title">Along your route</span>
                  <span className="rpgl__sync-head-dest">DEST</span>
                </div>

                <div className="rpgl__sync-body">
                  <div className="rpgl__driver-track">
                    <div className="rpgl__sync-outlook">
                      {outlookSteps.length > 0 ? (
                        <RouteOutlookTimeline
                          steps={outlookSteps}
                          samples={outlookSamples}
                          variant="synced"
                          showDriverLine={false}
                          showXTicks={false}
                          showNightLegend={showNightAxis}
                        />
                      ) : (
                        <div className="rpgl__outlook-wait" aria-hidden>
                          <span className="rpgl__outlook-wait-title">Route outlook</span>
                          <span className="rpgl__outlook-wait-hint">
                            Temperature and precipitation are still loading. Tap Refresh above to
                            fetch corridor weather again.
                          </span>
                        </div>
                      )}
                    </div>

                    {(radarSamples.length > 0 || routeWindGraphVisible(windPoints, gustSpikePoints)) ? (
                      <div className="rpgl__radar-strata">
                        <RouteRadarWindStrip
                          radarSamples={radarSamples}
                          windPoints={windPoints}
                          gustSpikePoints={gustSpikePoints}
                        />
                      </div>
                    ) : null}

                    <div className="rpgl__hazard-block">
                      <div className="rpgl__hazard-label" style={plotLabelInsetStyle}>
                        Hazards
                      </div>
                      {HAZARD_RAIL_ORDER.map((track) => (
                        <HazardRailRow key={track} track={track} bands={bandsByTrack[track]} />
                      ))}
                    </div>

                    {showNightAxis ? (
                      <RouteNightAxisOverlay
                        bands={nightBands}
                        transitions={nightTransitions}
                        labels={nightAxisLabels}
                      />
                    ) : null}

                    {stormCorridorIntersect ? (
                      <RouteStormIntersectOverlay
                        bands={stormCorridorIntersect.bands}
                        events={stormCorridorIntersect.events}
                      />
                    ) : null}

                    <div
                      className="rpgl__driver-overlay"
                      aria-hidden
                      style={
                        {
                          "--rpgl-driver-left": `${driverLeftPct}%`,
                          "--rpgl-driver-color": stripTint,
                        } as CSSProperties
                      }
                    >
                      <div className="rpgl__driver-vline" title="You are here" />
                    </div>
                  </div>

                  {tickSteps.length > 0 ? (
                    <div className="rpgl__sync-x-ticks" aria-hidden>
                      {tickSteps.map((step) => (
                        <div
                          key={`tick-${step.key}`}
                          className="rpgl__x-tick"
                          style={{ left: `${routePlotLeftPct(step.fraction)}%` }}
                          title={step.etaLabel ? `~${step.etaLabel} into trip` : undefined}
                        >
                          <span className="rpgl__x-label">{step.shortLabel}</span>
                          {step.etaLabel ? (
                            <span className="rpgl__x-eta">{step.etaLabel}</span>
                          ) : step.fraction <= 0.001 ? (
                            <span className="rpgl__x-eta">Now</span>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {hasDetail ? (
        <div
          className={`rpgl__detail-scroll${showAxis ? "" : " rpgl__detail-scroll--solo"}`}
          ref={detailScrollRef}
          aria-label="Hazards and route details"
        >
          {routeWide.length > 0 ? (
            <div className="rpgl__route-wide" role="group" aria-label="Whole route">
              {routeWide.map((it) => (
                <div key={it.key} className="rpgl__route-pill" title={it.tooltip}>
                  <span className="rpgl__route-pill-dot" style={{ backgroundColor: it.color }} aria-hidden />
                  <span className="rpgl__route-pill-title">{it.title.replace(/^Whole route\s*·\s*/i, "")}</span>
                  {it.summary ? <span className="rpgl__route-pill-summary">{it.summary}</span> : null}
                </div>
              ))}
            </div>
          ) : null}

          {visibleCards.length > 0 ? (
            <div className="rpgl__cards" role="list" aria-label="Hazards ahead">
              {visibleCards.map((card) => (
                <GlanceCard
                  key={card.id}
                  card={card}
                  scrollRef={card.id === activeScrollCardId ? activeCardScrollRef : undefined}
                />
              ))}
              {overflow > 0 ? (
                <p className="rpgl__overflow" aria-hidden>
                  +{overflow} more alerts ahead
                </p>
              ) : null}
            </div>
          ) : fallbackSegments.length > 0 ? (
            <div className="rpgl__cards" role="list" aria-label="Along route">
              {fallbackSegments.slice(0, MAX_GLANCE_CARDS).map((it) => (
                <FallbackCard key={it.key} item={it} userAlongMeters={userAlongMeters} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
