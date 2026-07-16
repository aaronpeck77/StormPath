import type { LngLat } from "../nav/types";
import type { TripStop } from "../nav/routeWaypoints";
import { shouldShowManualOffRouteUi, shouldShowTrafficBypassUi } from "../nav/constants";
import type { MapViewMode } from "./driveMapTypes";
import { RouteCompareBottomPanel } from "./RouteCompareBottomPanel";
import { RecordingRouteBanner } from "./RecordingRouteBanner";
import { DriveCompass } from "./DriveCompass";
import { NavMilesLeftBox } from "./NavMilesLeftBox";
import { RouteCycleButton, type RoutePickItem } from "./RoutePickBar";
import { SearchBar, type SearchSuggestion } from "./SearchBar";
import { RouteStopsBar } from "./RouteStopsBar";
import { BottomToolbar } from "./BottomToolbar";
import { isNarrowPhoneViewport } from "./mapFitLogic";

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
  addingViaStop: boolean;
  canAddStop: boolean;
  onStartAddStop: () => void;
  onCancelAddStop: () => void;
  handleRemoveViaStop: (index: number) => void;

  /* Bottom toolbar */
  handleViewModeChange: (m: MapViewMode) => void;
  onOpenSaved: () => void;
  handleGo: () => void;
  showGo: boolean;
  speedMph: number | null;
  postedMph: number | null;
  handleStopAndClear: () => void;
  hasTrip: boolean;
  showReturnTripButton: boolean;
  returnTripButtonLabel: string;
  returnTripTitle: string | undefined;
  handleReturnToPreviousDestination: () => void;
  showSavedPlacesButton: boolean;
  driveEtaMinutes: number | null;
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
  addingViaStop,
  canAddStop,
  onStartAddStop,
  onCancelAddStop,
  handleRemoveViaStop,
  handleViewModeChange,
  onOpenSaved,
  handleGo,
  showGo,
  speedMph,
  postedMph,
  handleStopAndClear,
  hasTrip,
  showReturnTripButton,
  returnTripButtonLabel,
  returnTripTitle,
  handleReturnToPreviousDestination,
  showSavedPlacesButton,
  driveEtaMinutes,
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
}: Props) {
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
        <div className="nav-bottom-dock">
          {navigationStarted && viewMode === "drive" ? (
            <div className="nav-bottom-dock__about-row">
              <div className="nav-bottom-dock__drive-about-cluster">
                <div className="nav-bottom-dock__compass-i-col">
                  <DriveCompass bearingDeg={driveMapBearingDeg} />
                  <button
                    type="button"
                    className="map-about-btn"
                    aria-label="About StormPath"
                    title="About / Settings"
                    onClick={onOpenAbout}
                  >
                    i
                  </button>
                </div>
                {driveDistanceRemainingLabel ? (
                  <NavMilesLeftBox label={driveDistanceRemainingLabel} />
                ) : null}
              </div>
            </div>
          ) : navigationStarted && viewMode === "topdown" ? (
            <div className="nav-bottom-dock__about-row">
              <button
                type="button"
                className="map-about-btn"
                aria-label="About StormPath"
                title="About / Settings"
                onClick={onOpenAbout}
              >
                i
              </button>
              {driveDistanceRemainingLabel ? (
                <NavMilesLeftBox label={driveDistanceRemainingLabel} />
              ) : null}
              {routePickItems.length >= 1 ? (
                <div className="nav-bottom-dock__route-toggle-slot nav-bottom-dock__route-toggle-slot--inline">
                  <RouteCycleButton
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
            </div>
          ) : (
            <div className="nav-bottom-dock__plan-stack">
              {/* About row hosts the round 'i' info button on the left and, when there are
               * routes to cycle, the route-select button inline to its right. The route-select
               * button is sized to fit the strip between the 'i' and the dock's right edge —
               * which is itself flush against the vertical progress rail — so adding the
               * select button doesn't push the rail narrower. */}
              {/* About row hosts the round 'i' info button on the left, plus an inline
               * action slot to its right. The slot shows route-select while a route is
               * loaded, or "My location" while planning (no routes yet). Both share the
               * same height + right inset so the dock keeps a single horizontal control
               * strip clear of the vertical progress rail. */}
              <div className="nav-bottom-dock__about-row">
                <button
                  type="button"
                  className="map-about-btn"
                  aria-label="About StormPath"
                  title="About / Settings"
                  onClick={onOpenAbout}
                >
                  i
                </button>
                {navigationStarted && driveDistanceRemainingLabel ? (
                  <NavMilesLeftBox label={driveDistanceRemainingLabel} />
                ) : null}
                {viewMode === "route" && routePickItems.length >= 1 ? (
                  <div className="nav-bottom-dock__route-toggle-slot nav-bottom-dock__route-toggle-slot--inline">
                    <RouteCycleButton
                      items={routePickItems}
                      selectedId={lineFocusId}
                      cycleOrderIds={planRouteIds}
                      activeSlotIndex={previewLegIndex}
                      onSelect={handlePreviewRouteSelect}
                      detail={routeDockDetail}
                    />
                  </div>
                ) : (viewMode === "route" || viewMode === "topdown") &&
                  planRoutesLength === 0 &&
                  userLngLat ? (
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
                ) : null}
              </div>
              <div className="nav-bottom-dock__search-myloc-row">
                <div className="nav-bottom-dock__search-col">
                  <div className="nav-search-dock">
                    {showCompactDest ? (
                      <button
                        type="button"
                        className="nav-dest-compact nav-dest-compact--tap"
                        onClick={handleCompactDestOpen}
                      >
                        <span className="nav-dest-compact-label" title={destinationLabel}>
                          {destinationLabel || "Destination"}
                        </span>
                      </button>
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
                          enableSuggestions={enableSuggestions}
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
