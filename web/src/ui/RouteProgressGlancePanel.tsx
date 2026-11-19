import { useEffect, useId, useMemo, useRef, useState, type RefObject } from "react";
import { scrollHazardCard } from "./routeHazardLink";
import type { RouteChunkCalloutItem } from "../nav/routeProgressChunkList";
import type { WxSample } from "../nav/routeChunkWeather";
import type { RouteOutlookStep } from "../nav/routeForecastTimeline";
import {
  buildRouteAheadGlanceCards,
  timelineItemShowsOnRouteGraph,
  type RouteAheadGlanceCard,
  type RouteAheadRelevance,
} from "../nav/routeAheadSync";
import type { TimelineItem } from "./RouteHazardTimeline";
import { RouteInfoLegend } from "./RouteInfoLegend";
import { RouteVerticalTimeline } from "./RouteVerticalTimeline";

type Props = {
  timeline: TimelineItem[];
  routeWide: RouteChunkCalloutItem[];
  outlookSteps: RouteOutlookStep[];
  outlookSamples?: WxSample[];
  /** RainViewer mosaic samples for the radar intensity strata */
  radarSamples?: { t: number; intensity: number }[];
  /** Sustained wind points from corridor forecast intervals (t=0–1 along route, mph) */
  windPoints?: { t: number; mph: number }[];
  /** Gust envelope along the route (dashed line). */
  gustLinePoints?: { t: number; mph: number }[];
  gustSpikePoints?: { t: number; mph: number }[];
  /** Optional status under radar/wind strata (age, rate-limit). */
  radarStatusNote?: string | null;
  fallbackSegments: RouteChunkCalloutItem[];
  totalMeters: number;
  userAlongMeters: number;
  planEtaMinutes: number | null;
  driveEtaMinutes?: number | null;
  userAlongT: number;
  stripTint: string;
  /** Parent scrolls this region vertically (alert list only). */
  detailScrollRef?: RefObject<HTMLDivElement | null>;
  /** TimelineItem.id of the drive-countdown "next" hazard — band/card get a highlight. */
  nextHazardId?: string | null;
  /** Hazard card/band tapped — lets the parent fly a PiP or map to it. */
  onHazardSelect?: (id: string) => void;
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

const MAX_GLANCE_CARDS = 6;

const HAZARD_RAIL_ORDER: TimelineItem["track"][] = ["nws", "road"]; // radar → strata, wind → graph

function GlanceCard({ card, scrollRef, selected, isNext = false, onSelect, id }: {
  card: RouteAheadGlanceCard;
  scrollRef: (element: HTMLDivElement | null) => void;
  selected: boolean;
  isNext?: boolean;
  onSelect?: () => void;
  id: string;
}) {
  return (
    <div
      ref={scrollRef}
      id={id}
      onClick={onSelect}
      className={`rpgl__card${card.inside ? " rpgl__card--current" : ""}${selected ? " rpgl__card--selected" : ""}${isNext ? " rpgl__card--next" : ""}`}
      role="listitem"
      title={card.tooltip}
      aria-current={card.inside ? "true" : undefined}
    >
      <div className="rpgl__card-body">
        <div className="rpgl__card-head">
          <span className="rpgl__dot" style={{ backgroundColor: card.color }} aria-hidden />
          <span className={`rpgl__track rpgl__track--${card.track}`}>{TRACK_BADGE[card.track]}</span>
          {onSelect ? (
            <button type="button" className={`rpgl__label rpgl__card-link rpgl__label--${card.severity}`}
              aria-label={`Show on graph: ${card.label}`} aria-pressed={selected}
              onClick={(event) => { event.stopPropagation(); onSelect(); }}>
              {card.label}
            </button>
          ) : <span className={`rpgl__label rpgl__label--${card.severity}`}>{card.label}</span>}
        </div>
        <div className="rpgl__meta">
          <span
            className={`rpgl__ahead${card.inside ? " rpgl__ahead--now" : ""}`}
            aria-label={`Distance along route: ${card.aheadLabel}`}
          >
            {card.aheadLabel}
          </span>
          {card.etaLabel ? <span className="rpgl__eta" aria-hidden>· {card.etaLabel}</span> : null}
          {card.relevance ? (
            <span className={`rpgl__chip rpgl__chip--rel rpgl__chip--rel-${card.relevance}`} aria-hidden>
              {RELEVANCE_LABEL[card.relevance]}
            </span>
          ) : null}
        </div>
        {card.detailLine ? <p className="rpgl__detail">{card.detailLine}</p> : null}
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
      <div className="rpgl__card-body">
        <div className="rpgl__card-head">
          <span className="rpgl__dot" style={{ backgroundColor: item.color }} aria-hidden />
          <span className="rpgl__label">{shortTitle}</span>
        </div>
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
  gustLinePoints = [],
  gustSpikePoints = [],
  radarStatusNote = null,
  fallbackSegments,
  totalMeters,
  userAlongMeters,
  planEtaMinutes,
  driveEtaMinutes = null,
  userAlongT,
  stripTint,
  detailScrollRef,
  nextHazardId = null,
  onHazardSelect,
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

  const hasGraphItems = useMemo(
    () => timeline.some((item) => timelineItemShowsOnRouteGraph(item)),
    [timeline]
  );

  const visibleCards = glanceCards;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const prefix = useId();
  const cardId = (id: string) => `${prefix}-hazard-${encodeURIComponent(id)}`;
  const linkableIds = useMemo(() => new Set(glanceCards.map((card) => card.id)), [glanceCards]);
  const activeScrollCardId = visibleCards.find((card) => card.inside)?.id ?? null;
  const selectCard = (id: string) => {
    setSelectedId(id);
    onHazardSelect?.(id);
    const panel = panelRef.current;
    const card = cardRefs.current.get(id);
    if (panel && card) scrollHazardCard(panel, card);
  };
  useEffect(() => {
    if (!activeScrollCardId || selectedId) return;
    const panel = panelRef.current;
    const card = cardRefs.current.get(activeScrollCardId);
    if (panel && card) scrollHazardCard(panel, card);
  }, [activeScrollCardId, selectedId]);
  useEffect(() => {
    if (selectedId && !linkableIds.has(selectedId)) setSelectedId(null);
  }, [selectedId, linkableIds]);
  const showAxis = outlookSteps.length > 0 || hasGraphItems || totalMeters > 0;
  /* Arrival forecast at the destination end of the route — the outlook's
   * last step is sampled at ETA, so its temp IS "when you get there". */
  const arrivalTempF = useMemo(() => {
    if (!outlookSteps.length) return null;
    const last = [...outlookSteps].sort((a, b) => b.fraction - a.fraction)[0];
    return last?.tempF ?? null;
  }, [outlookSteps]);

  /* Whole-route axis (Bill, Option B): no horizontal pan — the graph always
   * spans start→finish on the same 0–1 scale as the progress rail. */

  const hasDetail =
    routeWide.length > 0 || visibleCards.length > 0 || fallbackSegments.length > 0;

  return (
    <div className="rpgl" ref={(element) => { panelRef.current = element; if (detailScrollRef) detailScrollRef.current = element; }}>
      <RouteInfoLegend />
      {showAxis ? (
        <div className="rpgl__axis-pane">
          <RouteVerticalTimeline
            timeline={timeline}
            outlookSteps={outlookSteps}
            outlookSamples={outlookSamples}
            radarSamples={radarSamples}
            windPoints={windPoints}
            gustLinePoints={gustLinePoints}
            gustSpikePoints={gustSpikePoints}
            totalMeters={totalMeters}
            userAlongMeters={userAlongMeters}
            userAlongT={userAlongT}
            arrivalTempF={arrivalTempF}
            stripTint={stripTint}
            selectedId={selectedId}
            nextHazardId={nextHazardId}
            linkableIds={linkableIds}
            cardId={cardId}
            onBandSelect={selectCard}
          />
          {radarStatusNote ? (
            <p className="rpgl__radar-status" role="status">
              {radarStatusNote}
            </p>
          ) : null}
        </div>
      ) : null}

      {hasDetail ? (
        <div
          className={`rpgl__detail-scroll${showAxis ? "" : " rpgl__detail-scroll--solo"}`}
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
                  id={cardId(card.id)} selected={selectedId === card.id} isNext={card.id === nextHazardId}
                  scrollRef={(element) => { if (element) cardRefs.current.set(card.id, element); else cardRefs.current.delete(card.id); }}
                  onSelect={HAZARD_RAIL_ORDER.includes(card.track) ? () => selectCard(card.id) : undefined}
                />
              ))}
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
