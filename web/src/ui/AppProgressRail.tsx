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
  userAlongGuidanceM: number;
  progressStripAlerts: RouteAlert[];
  radarIntensity: number;
  progressStripRouteColor: string;
  progressRailRouteTurnSteps: RouteTurnStep[] | undefined;
  turnSteps: RouteTurnStep[];
  routeAheadProgressBands: StormProgressBand[];
  driveModeUi: boolean;
  tripOdometerM: number;
  navigationStarted: boolean;
};

/** Vertical side rail: expandable route-info panel + progress strip. */
export function AppProgressRail({
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
  userAlongGuidanceM,
  progressStripAlerts,
  radarIntensity,
  progressStripRouteColor,
  progressRailRouteTurnSteps,
  turnSteps,
  routeAheadProgressBands,
  driveModeUi,
  tripOdometerM,
  navigationStarted,
}: Props) {
  return (
    <div
      className={`nav-route-progress-rail${progressCalloutsOpen && progressCalloutCount > 0 ? " nav-route-progress-rail--callouts-open" : ""}`}
    >
      <div className="nav-route-progress-rail__inner">
        <RouteProgressCalloutRail
          open={progressCalloutsOpen}
          onOpenChange={onProgressCalloutsOpenChange}
          hasContent={progressCalloutCount > 0}
          showRefresh={showRefresh}
          refreshBusy={routeInfoWeatherRefreshing}
          refreshNote={routeInfoRefreshNote}
          refreshNoteTone={routeInfoRefreshNoteTone}
          onRefresh={onRefreshRouteInfoWeather}
        >
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
          />
        </RouteProgressCalloutRail>
        <RouteProgressStrip
          layout="side"
          geometry={progressRailRouteGeometry}
          userLngLat={effectiveUserLngLat}
          userAlongMeters={userAlongGuidanceM}
          alerts={progressStripAlerts}
          radarIntensity={radarIntensity}
          routeLineColor={progressStripRouteColor}
          turnSteps={progressRailRouteTurnSteps ?? turnSteps}
          stormBands={routeAheadProgressBands}
          driveEndsEmphasis={driveModeUi}
          tripOdometerM={tripOdometerM}
          tripRelativeProgress={navigationStarted}
          routeInfoOpen={progressCalloutsOpen}
          onRouteInfoOpenChange={progressCalloutCount > 0 ? onProgressCalloutsOpenChange : undefined}
        />
      </div>
    </div>
  );
}
