import type { RefObject } from "react";
import type { LngLat, RouteTurnStep } from "../nav/types";
import type { RouteAlert } from "../nav/routeAlerts";
import type { RouteChunkCalloutItem } from "../nav/routeProgressChunkList";
import type { WxSample } from "../nav/routeChunkWeather";
import type { RouteOutlookStep } from "../nav/routeForecastTimeline";
import type { TimelineItem } from "./RouteHazardTimeline";
import type { StormProgressBand } from "./RouteProgressStrip";
import { formatRadarSampleAge } from "../hooks/useRadarBandsAlongRoute";
import { RouteProgressCalloutRail } from "./RouteProgressCalloutRail";
import { RouteProgressGlancePanel } from "./RouteProgressGlancePanel";
import { RouteProgressStrip } from "./RouteProgressStrip";

type Props = {
  onBend?: () => void;
  bendOnline?: boolean;
  progressCalloutsOpen: boolean;
  onProgressCalloutsOpenChange: (open: boolean) => void;
  progressCalloutCount: number;
  showRefresh: boolean;
  routeInfoWeatherRefreshing: boolean;
  routeInfoRefreshNote: string | null;
  routeInfoRefreshNoteTone: "info" | "warn";
  onRefreshRouteInfoWeather: () => void;

  routeAheadTimeline: TimelineItem[];
  routeWide: RouteChunkCalloutItem[];
  outlookSteps: RouteOutlookStep[];
  outlookSamples: WxSample[] | undefined;
  radarMosaicSamples: { t: number; intensity: number }[];
  radarSliceLoopFrames?: { t: number; intensity: number }[][];
  radarRefreshBlocked: string | null;
  radarMosaicUpdatedAt: number | null;
  windPoints: { t: number; mph: number }[];
  gustLinePoints: { t: number; mph: number }[];
  gustSpikePoints: { t: number; mph: number }[];
  fallbackSegments: RouteChunkCalloutItem[];
  guidanceRouteLengthM: number;
  progressPanelAlongM: number;
  planEtaMinutes: number | null;
  driveEtaMinutes: number | null;
  progressCalloutUserAlongT: number;
  stripTint: string;
  progressCalloutDetailScrollRef: RefObject<HTMLDivElement | null>;

  progressRailRouteGeometry: LngLat[];
  effectiveUserLngLat: LngLat | null;
  progressStripAlerts: RouteAlert[];
  radarIntensity: number;
  progressStripRouteColor: string;
  progressRailRouteTurnSteps: RouteTurnStep[] | undefined;
  turnSteps: RouteTurnStep[];
  routeAheadProgressBands: StormProgressBand[];
  driveModeUi: boolean;
  tripOdometerM: number;
  navigationStarted: boolean;
  /** TimelineItem.id of the drive-countdown "next" hazard — highlighted in the glance graph. */
  nextHazardId?: string | null;
  /** Hazard card/band tapped — parent flies the map (and PiP when present). */
  onHazardSelect?: (id: string) => void;
};

/** Vertical side rail: expandable route-info panel + progress strip. */
export function AppProgressRail({
  onBend,
  bendOnline = true,
  progressCalloutsOpen,
  onProgressCalloutsOpenChange,
  progressCalloutCount,
  showRefresh,
  routeInfoWeatherRefreshing,
  routeInfoRefreshNote,
  routeInfoRefreshNoteTone,
  onRefreshRouteInfoWeather,
  routeAheadTimeline,
  routeWide,
  outlookSteps,
  outlookSamples,
  radarMosaicSamples,
  radarSliceLoopFrames,
  radarRefreshBlocked,
  radarMosaicUpdatedAt,
  windPoints,
  gustLinePoints,
  gustSpikePoints,
  fallbackSegments,
  guidanceRouteLengthM,
  progressPanelAlongM,
  planEtaMinutes,
  driveEtaMinutes,
  progressCalloutUserAlongT,
  stripTint,
  progressCalloutDetailScrollRef,
  progressRailRouteGeometry,
  effectiveUserLngLat,
  progressStripAlerts,
  radarIntensity,
  progressStripRouteColor,
  progressRailRouteTurnSteps,
  turnSteps,
  routeAheadProgressBands,
  driveModeUi,
  tripOdometerM,
  navigationStarted,
  nextHazardId = null,
  onHazardSelect,
}: Props) {
  return (
    <div
      className={`nav-route-progress-rail${progressCalloutsOpen && (progressCalloutCount > 0 || Boolean(onBend)) ? " nav-route-progress-rail--callouts-open" : ""}`}
    >
      <div className="nav-route-progress-rail__inner">
        <RouteProgressCalloutRail
          open={progressCalloutsOpen}
          onOpenChange={onProgressCalloutsOpenChange}
          hasContent={(progressCalloutCount > 0 || Boolean(onBend))}
          showRefresh={showRefresh}
          refreshBusy={routeInfoWeatherRefreshing}
          refreshNote={routeInfoRefreshNote}
          refreshNoteTone={routeInfoRefreshNoteTone}
          onRefresh={onRefreshRouteInfoWeather}
        >
          {onBend ? (
            <details className="nav-bend-options">
              <summary>Route options</summary>
              <p>Pull the route around a blockage when stopped or with a passenger. A bend does not guarantee hazard avoidance.</p>
              <button type="button" onClick={onBend} disabled={!bendOnline}>Bend route</button>
              {!bendOnline ? <p>Bend needs a connection. Your current route stays active.</p> : null}
            </details>
          ) : null}
          {/* Horizontal twin of the side rail — same strip, flat, so the
           * route-info page shows turns/storms/radar with the weather graph. */}
          <div className="route-progress-callout-panel__strip">
            <RouteProgressStrip
              layout="fullBleed"
              geometry={progressRailRouteGeometry}
              userLngLat={effectiveUserLngLat}
              userAlongMeters={progressPanelAlongM}
              alerts={progressStripAlerts}
              radarIntensity={radarIntensity}
              routeLineColor={progressStripRouteColor}
              turnSteps={
                progressRailRouteTurnSteps && progressRailRouteTurnSteps.length >= 2
                  ? progressRailRouteTurnSteps
                  : turnSteps
              }
              stormBands={routeAheadProgressBands}
              radarSliceSamples={radarMosaicSamples}
              radarSliceLoopFrames={radarSliceLoopFrames}
              driveEndsEmphasis={driveModeUi}
              tripOdometerM={tripOdometerM}
              tripRelativeProgress={navigationStarted}
            />
          </div>
          <RouteProgressGlancePanel
            timeline={routeAheadTimeline}
            routeWide={routeWide}
            outlookSteps={outlookSteps}
            outlookSamples={outlookSamples}
            radarSamples={radarMosaicSamples}
            radarStatusNote={
              radarRefreshBlocked ??
              (radarMosaicSamples.length > 0 ? formatRadarSampleAge(radarMosaicUpdatedAt) : null)
            }
            windPoints={windPoints}
            gustLinePoints={gustLinePoints}
            gustSpikePoints={gustSpikePoints}
            fallbackSegments={fallbackSegments}
            totalMeters={guidanceRouteLengthM}
            userAlongMeters={progressPanelAlongM}
            planEtaMinutes={planEtaMinutes}
            driveEtaMinutes={driveEtaMinutes}
            userAlongT={progressCalloutUserAlongT}
            stripTint={stripTint}
            detailScrollRef={progressCalloutDetailScrollRef}
            nextHazardId={nextHazardId}
            onHazardSelect={onHazardSelect}
          />
        </RouteProgressCalloutRail>
        <RouteProgressStrip
          layout="side"
          geometry={progressRailRouteGeometry}
          userLngLat={effectiveUserLngLat}
          userAlongMeters={progressPanelAlongM}
          alerts={progressStripAlerts}
          radarIntensity={radarIntensity}
          routeLineColor={progressStripRouteColor}
          turnSteps={
            progressRailRouteTurnSteps && progressRailRouteTurnSteps.length >= 2
              ? progressRailRouteTurnSteps
              : turnSteps
          }
          stormBands={routeAheadProgressBands}
          radarSliceSamples={radarMosaicSamples}
          radarSliceLoopFrames={radarSliceLoopFrames}
          driveEndsEmphasis={driveModeUi}
          tripOdometerM={tripOdometerM}
          tripRelativeProgress={navigationStarted}
          routeInfoOpen={progressCalloutsOpen}
          onRouteInfoOpenChange={(progressCalloutCount > 0 || Boolean(onBend)) ? onProgressCalloutsOpenChange : undefined}
        />
      </div>
    </div>
  );
}
