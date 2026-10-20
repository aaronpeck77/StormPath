import type { ReactNode } from "react";
import type { LngLat } from "../nav/types";
import type { TripStop } from "../nav/routeWaypoints";
import { shouldShowManualOffRouteUi, shouldShowTrafficBypassUi } from "../nav/constants";
import type { MapViewMode } from "./driveMapTypes";
import { RouteCompareBottomPanel } from "./RouteCompareBottomPanel";
import { RecordingRouteBanner } from "./RecordingRouteBanner";
import { DriveCompass } from "./DriveCompass";
import { NavMilesLeftBox } from "./NavMilesLeftBox";
import { RoutePickControl, type RoutePickItem } from "./RoutePickBar";
import { SearchBar, type SearchSuggestion } from "./SearchBar";
import { RouteStopsBar } from "./RouteStopsBar";
import { BottomToolbar } from "./BottomToolbar";
import { isNarrowPhoneViewport } from "./mapFitLogic";
import { showTripRefreshButton } from "../nav/tripRefresh";
import { assistantButtonLabel, stormyButtonFor } from "../voice/voiceLevel";
import { AssistantButton } from "./AssistantButton";
import { StormyButton, stormyTurnImminent } from "./StormyButton";
import { useSettingsStore } from "../state/settingsStore";
import { useTripPlanStore } from "../state/tripPlanStore";
import type { StormyActResult, StormyPacket, StormyReply } from "../stormy/stormyFence";

function MapInfoButton({ onOpenAbout }: { onOpenAbout: () => void }) {
  return (
    <button
      type="button"
      className="map-about-btn"
      aria-label="About StormPath"
      title="About / Settings"
      onClick={onOpenAbout}
    >
      i
    </button>
  );
}

/** Stormy on: compass and Info stay left, and her row holds the other chips. Off: the pre-Stormy row. */
function DockAboutRow({
  stormyOn,
  onOpenAbout,
  compass,
  stormy,
  refresh,
  children,
}: {
  stormyOn: boolean;
  onOpenAbout: () => void;
  compass?: ReactNode;
  stormy?: ReactNode;
  refresh?: ReactNode;
  children?: ReactNode;
}) {
  const info = <MapInfoButton onOpenAbout={onOpenAbout} />;
  if (!stormyOn) {
    if (compass) {
      return (
        <div className="nav-bottom-dock__about-row">
          <div className="nav-bottom-dock__drive-about-cluster">
            <div className="nav-bottom-dock__compass-i-col">
              {refresh}
              {compass}
              {info}
            </div>
            {children}
          </div>
        </div>
      );
    }
    return (
      <div className="nav-bottom-dock__about-row">
        {info}
        {children}
      </div>
    );
  }
  return (
    <div className="nav-bottom-dock__about-row">
      <div className="nav-bottom-dock__info-stormy-col">
        {refresh}
        {compass}
        {info}
        <div className="nav-bottom-dock__stormy-row">
          {stormy}
          {children}
        </div>
      </div>
    </div>
  );
}

type Props = {
  /* Traffic-bypass compare panel */
  handleTrafficBypassCompareSelect: (id: "r-a" | "r-b" | "r-c") => void;
  handleTrafficBypassCompareConfirm: () => void;
  handleTrafficBypassCompareCancel: () => void;

  /* Recording banner + outer gates */
  recordingActive: boolean;
  trafficBypassCompareActive: boolean;
  recordingPointCount: number;
  recordingLengthM: number;
  handleStopRecordingSave: () => void;
  handleDiscardRecordingPath: () => void;

  /* Dock mode branching */
  navigationStarted: boolean;
  viewMode: MapViewMode;

  /* Drive / topdown about-row */
  driveMapBearingDeg: number | null;
  /** Drive only. Restarts stuck guidance and live data without ending the trip. */
  onRefreshTrip?: () => void;
  onOpenAbout: () => void;
  driveDistanceRemainingLabel: string | null;

  /* Route-cycle chip + radar dock chip */
  routePickItems: RoutePickItem[];
  lineFocusId: string;
  planRouteIds: string[];
  previewLegIndex: number | null;
  handlePreviewRouteSelect: (id: string) => void;
  routeDockDetail: string | undefined;
  radarMapOverlayOn: boolean;
  radarFrameTimeLabel: string | null;

  /* Plan-stack "My location" recenter */
  planRoutesLength: number;
  userLngLat: LngLat | null;
  onRecenterPlanningPuck: () => void;

  /* Search row */
  showCompactDest: boolean;
  handleCompactDestOpen: () => void;
  destinationLabel: string;
  searchText: string;
  onSearchTextChange: (v: string) => void;
  handleSearchFieldBeginEditing: () => void;
  handleSearchFieldEndEditing: () => void;
  handleSearchCancelSuggestions: () => void;
  handleSearchDismiss: () => void;
  onSearchSubmit: () => void;
  searchPlaceholder: string;
  suggestions: SearchSuggestion[];
  onPickSuggestion: (h: SearchSuggestion) => void;
  suggestLoading: boolean;
  enableSuggestions: boolean;

  /* Via-stop bar */
  viaStops: TripStop[];
  activeViaIndex: number;
  addingViaStop: boolean;
  canAddStop: boolean;
  onStartAddStop: () => void;
  onCancelAddStop: () => void;
  handleRemoveViaStop: (index: number) => void;
  handleSkipViaStop: (index: number) => void;

  /* Bottom toolbar */
  handleViewModeChange: (m: MapViewMode) => void;
  onOpenSaved: () => void;
  handleGo: () => void;
  showGo: boolean;
  speedMph: number | null;
  postedMph: number | null;
  postedMphIsClassEstimate: boolean;
  postedMphFromHorizon?: boolean;
  useMiles?: boolean;
  handleStopAndClear: () => void;
  hasTrip: boolean;
  showReturnTripButton: boolean;
  returnTripButtonLabel: string;
  returnTripTitle: string | undefined;
  handleReturnToPreviousDestination: () => void;
  showSavedPlacesButton: boolean;
  driveEtaMinutes: number | null;
  destLngLat?: LngLat | null;
  onToggleRadar: () => void;
  settingRadarEnabled: boolean;
  driveModeUi: boolean;
  showOffRouteStatusBanner: boolean;
  detourAutoActive: boolean;
  detourRejoinDistanceLabel: string | null;
  routing: boolean;
  onStayOnThisRoad: () => void;
  returnToOriginalRoute: () => void;
  showTrafficBypassCta: boolean;
  bypassBusy: boolean;
  onTrafficBypassFromHere: () => void;
  stormyAheadLine: string | null;
  stormyHazardLine: string | null;
  stormyWeather?: string[];
  stormyTraffic?: string[];
  stormyRoads?: string[];
  stormyForecast?: string;
  stormyHere?: string;
  metersToManeuver: number | null;
  onStormyAct?: (reply: StormyReply) => Promise<StormyActResult>;
};

/** Bottom dock chrome — route-compare panel, recording banner, the about/search/toolbar dock, and BottomToolbar. */
export function AppBottomChrome({
  handleTrafficBypassCompareSelect,
  handleTrafficBypassCompareConfirm,
  handleTrafficBypassCompareCancel,
  recordingActive,
  trafficBypassCompareActive,
  recordingPointCount,
  recordingLengthM,
  handleStopRecordingSave,
  handleDiscardRecordingPath,
  navigationStarted,
  viewMode,
  driveMapBearingDeg,
  onRefreshTrip,
  onOpenAbout,
  driveDistanceRemainingLabel,
  routePickItems,
  lineFocusId,
  planRouteIds,
  previewLegIndex,
  handlePreviewRouteSelect,
  routeDockDetail,
  radarMapOverlayOn,
  radarFrameTimeLabel,
  planRoutesLength,
  userLngLat,
  onRecenterPlanningPuck,
  showCompactDest,
  handleCompactDestOpen,
  destinationLabel,
  searchText,
  onSearchTextChange,
  handleSearchFieldBeginEditing,
  handleSearchFieldEndEditing,
  handleSearchCancelSuggestions,
  handleSearchDismiss,
  onSearchSubmit,
  searchPlaceholder,
  suggestions,
  onPickSuggestion,
  suggestLoading,
  enableSuggestions,
  viaStops,
  activeViaIndex,
  addingViaStop,
  canAddStop,
  onStartAddStop,
  onCancelAddStop,
  handleRemoveViaStop,
  handleSkipViaStop,
  handleViewModeChange,
  onOpenSaved,
  handleGo,
  showGo,
  speedMph,
  postedMph,
  postedMphIsClassEstimate,
  postedMphFromHorizon = false,
  useMiles = true,
  handleStopAndClear,
  hasTrip,
  showReturnTripButton,
  returnTripButtonLabel,
  returnTripTitle,
  handleReturnToPreviousDestination,
  showSavedPlacesButton,
  driveEtaMinutes,
  destLngLat = null,
  onToggleRadar,
  settingRadarEnabled,
  driveModeUi,
  showOffRouteStatusBanner,
  detourAutoActive,
  detourRejoinDistanceLabel,
  routing,
  onStayOnThisRoad,
  returnToOriginalRoute,
  showTrafficBypassCta,
  bypassBusy,
  onTrafficBypassFromHere,
  stormyAheadLine,
  stormyHazardLine,
  stormyWeather = [],
  stormyTraffic = [],
  stormyRoads = [],
  stormyForecast = "",
  stormyHere = "",
  metersToManeuver,
  onStormyAct,
}: Props) {
  const planRoutes = useTripPlanStore((s) => s.plan.routes);
  const voiceLevel = useSettingsStore((s) => s.voiceLevel);
  const assistantEnabled = useSettingsStore((s) => s.assistantEnabled);
  const assistantName = useSettingsStore((s) => s.assistantName);
  const assistantOn = assistantEnabled;
  const stormyOn = stormyButtonFor(voiceLevel, assistantEnabled);
  const talkOn = stormyOn || assistantOn;
  const stormyPacket: StormyPacket = {
    aheadLine: (stormyAheadLine || destinationLabel || "").trim(),
    hazards: stormyHazardLine ? [stormyHazardLine] : [],
    routes: planRoutes.slice(0, 3).map((route) => ({
      id: route.id,
      label: route.label,
      summary: `${Math.round(route.baseEtaMinutes)} min`,
    })),
    driving: navigationStarted,
    turnImminent: stormyTurnImminent(navigationStarted, metersToManeuver),
    question: "",
    weather: stormyWeather,
    traffic: stormyTraffic,
    roads: stormyRoads,
    forecast: stormyForecast,
    destination: destinationLabel.trim(),
    eta: driveEtaMinutes != null && Number.isFinite(driveEtaMinutes) ? `${Math.round(driveEtaMinutes)} minutes` : "",
    milesLeft: (driveDistanceRemainingLabel ?? "").trim(),
    stops: viaStops.map((stop) => stop.label).filter(Boolean).slice(0, 3),
    here: stormyHere.trim(),
  };
  const talkButton = stormyOn ? (
    <StormyButton packet={stormyPacket} onAct={onStormyAct} />
  ) : assistantOn ? (
    <AssistantButton name={assistantButtonLabel(assistantName)} packet={stormyPacket} onAct={onStormyAct} />
  ) : null;
  const placeChoices = talkOn && suggestions.length >= 2 ? suggestions.slice(0, 8) : [];
  return (
    <div className="nav-bottom-stack">
      <RouteCompareBottomPanel
        onSelect={handleTrafficBypassCompareSelect}
        onConfirm={handleTrafficBypassCompareConfirm}
        onCancel={handleTrafficBypassCompareCancel}
      />

      {recordingActive && !trafficBypassCompareActive ? (
        <RecordingRouteBanner
          pointCount={recordingPointCount}
          lengthMeters={recordingLengthM}
          onStopSave={handleStopRecordingSave}
          onDiscard={handleDiscardRecordingPath}
        />
      ) : null}
      {!trafficBypassCompareActive ? (
      <div className="nav-bottom-chrome-wrap">
        {placeChoices.length >= 2 ? (
          <ul className="stormy-place-choices" aria-label="Places to choose">
            {placeChoices.map((hit) => (
              <li key={hit.id}>
                <button type="button" onClick={() => onPickSuggestion(hit)}>
                  <span className="stormy-place-choices__name">{hit.placeName}</span>
                  {hit.secondary ? <span className="stormy-place-choices__detail">{hit.secondary}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="nav-bottom-dock">
          {navigationStarted && viewMode === "drive" ? (
            <DockAboutRow
              stormyOn={talkOn}
              onOpenAbout={onOpenAbout}
              refresh={
                showTripRefreshButton(navigationStarted, viewMode) && onRefreshTrip ? (
                  <button
                    type="button"
                    className="trip-refresh-btn"
                    aria-label="Refresh the trip"
                    title="Refresh the trip without leaving it"
                    onClick={onRefreshTrip}
                  >
                    ↻
                  </button>
                ) : null
              }
              compass={<DriveCompass bearingDeg={driveMapBearingDeg} />}
              stormy={talkButton}
            >
              {driveDistanceRemainingLabel ? (
                <NavMilesLeftBox label={driveDistanceRemainingLabel} />
              ) : null}
            </DockAboutRow>
          ) : navigationStarted && viewMode === "topdown" ? (
            <DockAboutRow
              stormyOn={talkOn}
              onOpenAbout={onOpenAbout}
              stormy={talkButton}
            >
              {driveDistanceRemainingLabel ? (
                <NavMilesLeftBox label={driveDistanceRemainingLabel} />
              ) : null}
              {routePickItems.length >= 1 ? (
                <div className="nav-bottom-dock__route-toggle-slot nav-bottom-dock__route-toggle-slot--inline">
                  <RoutePickControl
                    items={routePickItems}
                    selectedId={lineFocusId}
                    cycleOrderIds={planRouteIds}
                    activeSlotIndex={previewLegIndex}
                    onSelect={handlePreviewRouteSelect}
                    detail={routeDockDetail}
                  />
                </div>
              ) : radarMapOverlayOn && radarFrameTimeLabel ? (
                <div
                  className="nav-radar-frame-time-dock"
                  aria-live="polite"
                  title="Radar mosaic time (your local time)"
                >
                  {radarFrameTimeLabel}
                </div>
              ) : null}
            </DockAboutRow>
          ) : (
            <div className="nav-bottom-dock__plan-stack">
              {/* About row: 'i' on the left; route-info cycle chip or My location in the inline slot. */}
              <DockAboutRow
                stormyOn={talkOn}
                onOpenAbout={onOpenAbout}
                stormy={talkButton}
              >
                {navigationStarted && driveDistanceRemainingLabel ? (
                  <NavMilesLeftBox label={driveDistanceRemainingLabel} />
                ) : null}
                {viewMode === "route" || viewMode === "topdown" ? (
                  routePickItems.length >= 1 ? (
                    <div className="nav-bottom-dock__route-toggle-slot nav-bottom-dock__route-toggle-slot--inline">
                      <RoutePickControl
                        items={routePickItems}
                        selectedId={lineFocusId}
                        cycleOrderIds={planRouteIds}
                        activeSlotIndex={previewLegIndex}
                        onSelect={handlePreviewRouteSelect}
                        detail={routeDockDetail}
                      />
                    </div>
                  ) : planRoutesLength === 0 && userLngLat ? (
                    <button
                      type="button"
                      className="nav-recenter-puck-btn nav-recenter-puck-btn--dock nav-recenter-puck-btn--inline"
                      title="Center map on your location"
                      aria-label="Center map on your location"
                      onClick={onRecenterPlanningPuck}
                    >
                      My location
                    </button>
                  ) : radarMapOverlayOn && radarFrameTimeLabel ? (
                    <div
                      className="nav-radar-frame-time-dock"
                      aria-live="polite"
                      title="Radar mosaic time (your local time)"
                    >
                      {radarFrameTimeLabel}
                    </div>
                  ) : null
                ) : null}
              </DockAboutRow>
              <div className="nav-bottom-dock__search-myloc-row">
                <div className="nav-bottom-dock__search-col">
                  <div className="nav-search-dock">
                    {showCompactDest ? (
                      <div className="nav-dest-compact">
                        <button
                          type="button"
                          className="nav-dest-compact--tap"
                          onClick={handleCompactDestOpen}
                        >
                          <span className="nav-dest-compact-label" title={destinationLabel}>
                            {destinationLabel || "Destination"}
                          </span>
                        </button>
                        {navigationStarted && activeViaIndex < viaStops.length ? (
                          <button
                            type="button"
                            className="nav-dest-compact-btn"
                            onClick={() => handleSkipViaStop(activeViaIndex)}
                          >
                            Skip stop
                          </button>
                        ) : null}
                      </div>
                    ) : (
                      <>
                        <SearchBar
                          value={searchText}
                          onChange={onSearchTextChange}
                          onBeginEditing={handleSearchFieldBeginEditing}
                          onEndEditing={handleSearchFieldEndEditing}
                          onCancelSuggestions={handleSearchCancelSuggestions}
                          onDismiss={handleSearchDismiss}
                          onSearch={onSearchSubmit}
                          placeholder={searchPlaceholder}
                          suggestions={suggestions}
                          onPickSuggestion={onPickSuggestion}
                          suggestionsLoading={suggestLoading}
                          showSuggestionsWhenEmpty={isNarrowPhoneViewport()}
                          enableSuggestions={enableSuggestions && placeChoices.length < 2}
                        />
                        {!navigationStarted ? (
                          <RouteStopsBar
                            viaStops={viaStops}
                            addingStop={addingViaStop}
                            canAddStop={canAddStop}
                            onStartAddStop={onStartAddStop}
                            onCancelAddStop={onCancelAddStop}
                            onRemoveStop={handleRemoveViaStop}
                          />
                        ) : null}
                      </>
                    )}
                  </div>
                </div>
              </div>
              {/* Action row removed — both "My location" (planning) and the route-cycle
               * button (route loaded) now live inline on the about-row above the search. */}
            </div>
          )}
        </div>

        <BottomToolbar
          viewMode={viewMode}
          onViewMode={handleViewModeChange}
          onOpenSaved={onOpenSaved}
          navigationStarted={navigationStarted}
          onGo={handleGo}
          showGo={showGo}
          speedMph={speedMph}
          postedMph={postedMph}
          postedMphIsClassEstimate={postedMphIsClassEstimate}
          postedMphFromHorizon={postedMphFromHorizon}
          useMiles={useMiles}
          onStop={handleStopAndClear}
          hasTrip={hasTrip}
          showReturnTripButton={showReturnTripButton}
          returnTripLabel={returnTripButtonLabel}
          returnTripTitle={returnTripTitle}
          onReturnTrip={handleReturnToPreviousDestination}
          showSavedPlacesButton={showSavedPlacesButton}
          showViewCycleButton
          viewCycleDisabled={!navigationStarted}
          driveEtaMinutes={driveEtaMinutes}
          destLngLat={destLngLat}
          showRadar={radarMapOverlayOn}
          onToggleRadar={onToggleRadar}
          radarEnabled={settingRadarEnabled}
          showRadarButton={!driveModeUi}
          showOffRouteBanner={shouldShowManualOffRouteUi() && showOffRouteStatusBanner}
          offRouteRejoinActive={detourAutoActive}
          offRouteRejoinDistanceLabel={detourRejoinDistanceLabel}
          offRouteOptionsBusy={routing}
          onStayOnThisRoad={shouldShowManualOffRouteUi() ? onStayOnThisRoad : undefined}
          onReturnToOriginalRoute={shouldShowManualOffRouteUi() ? returnToOriginalRoute : undefined}
          showTrafficBypass={shouldShowTrafficBypassUi() && showTrafficBypassCta}
          bypassBusy={bypassBusy}
          onTrafficBypass={shouldShowTrafficBypassUi() ? onTrafficBypassFromHere : undefined}
        />
      </div>
      ) : null}
    </div>
  );
}
