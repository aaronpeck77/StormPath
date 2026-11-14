import type { ReactNode } from "react";
import type { LngLat } from "../nav/types";
import { MAX_VIA_STOPS, type TripStop } from "../nav/routeWaypoints";
import { shouldShowManualOffRouteUi, shouldShowTrafficBypassUi } from "../nav/constants";
import type { MapViewMode } from "./driveMapTypes";
import { RouteCompareBottomPanel } from "./RouteCompareBottomPanel";
import { RecordingRouteBanner } from "./RecordingRouteBanner";
import { DriveCompass } from "./DriveCompass";
import { NavMilesLeftBox } from "./NavMilesLeftBox";
import { LandscapeNavigationDock, useTabletLandscape } from "./LandscapeNavigationDock";
import { RoutePickControl, type RoutePickItem } from "./RoutePickBar";
import { SearchBar, type SearchSuggestion } from "./SearchBar";
import { RouteStopsBar } from "./RouteStopsBar";
import { BottomToolbar } from "./BottomToolbar";
import { isNarrowPhoneViewport } from "./mapFitLogic";
import { showTripRefreshButton } from "../nav/tripRefresh";
import { stormyButtonFor } from "../voice/voiceLevel";
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
  tools,
  leadingActions,
  infoAside,
  aboutRowClassName,
  toolsAfterChildren = false,
  routeRowAbove,
  children,
}: {
  stormyOn: boolean;
  onOpenAbout: () => void;
  compass?: ReactNode;
  stormy?: ReactNode;
  refresh?: ReactNode;
  tools?: ReactNode;
  /** Small stacked shortcuts rendered directly above the info button. */
  leadingActions?: ReactNode;
  /** Compact read-out rendered immediately to the right of the info button. */
  infoAside?: ReactNode;
  /** Extra class for the about-row (MP/RT bottom alignment). */
  aboutRowClassName?: string;
  /** Render the inline route slot before Tools so it sits beside miles-left. */
  toolsAfterChildren?: boolean;
  /** Slim row rendered directly above the stormy/route-select line (CarPlay
   * map-peek return chip) — only used by the stormyOn layout. */
  routeRowAbove?: ReactNode;
  children?: ReactNode;
}) {
  const infoButton = <MapInfoButton onOpenAbout={onOpenAbout} />;
  const aboutRowClass = `nav-bottom-dock__about-row${
    aboutRowClassName ? ` ${aboutRowClassName}` : ""
  }`;
  const info = leadingActions || infoAside ? (
    <div className="nav-bottom-dock__info-actions-col">
      {leadingActions}
      <div className="nav-bottom-dock__info-row">
        {infoButton}
        {infoAside}
      </div>
    </div>
  ) : (
    infoButton
  );
  if (!stormyOn) {
    if (compass) {
      return (
        <div className={aboutRowClass}>
          <div className="nav-bottom-dock__drive-about-cluster">
            <div className="nav-bottom-dock__compass-i-col">
              {refresh}
              {compass}
              {info}
              {tools}
            </div>
            {children}
          </div>
        </div>
      );
    }
    return (
      <div className={aboutRowClass}>
        {info}
        {toolsAfterChildren ? children : tools}
        {toolsAfterChildren ? tools : children}
      </div>
    );
  }
  return (
    <div className={aboutRowClass}>
      <div className="nav-bottom-dock__info-stormy-col">
        {refresh}
        {compass}
        {info}
        {tools}
        {routeRowAbove ? <div className="nav-cp-return-row">{routeRowAbove}</div> : null}
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

  /* Mid-route destination change */
  onChangeDestination?: () => void;
  isChangingDestination?: boolean;

  /* Drive / topdown about-row */
  driveMapBearingDeg: number | null;
  /** Drive only. Restarts stuck guidance and live data without ending the trip. */
  onRefreshTrip?: () => void;
  onOpenAbout: () => void;
  /** Tablet-only direct entry to the StormPath Tools sheet (hidden on phones via CSS). */
  onOpenTools?: () => void;
  driveDistanceRemainingLabel: string | null;
  /** CarPlay map-peek: "Weather & hazards" return chip, rendered right of the miles-left box. */
  carPlayMapReturn?: ReactNode;
  /** iPad landscape command-panel widgets (hazard countdown, PiP) between nav dock and bottom chrome. */
  panelWidgets?: ReactNode;

  /* Route-cycle chip + radar dock chip */
  routePickItems: RoutePickItem[];
  lineFocusId: string;
  planRouteIds: string[];
  previewLegIndex: number | null;
  handlePreviewRouteSelect: (id: string) => void;
  routeDockDetail: string | undefined;
  /** "Another way" — re-plan the alternates around a different corridor. */
  onAnotherWay?: () => void;
  anotherWayBusy?: boolean;
  /** Pre-trip briefing pill — planning surface only, rendered beside the route picker. */
  tripBriefingPill?: ReactNode;
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
  hazardBypassActive?: boolean;
  hazardBypassBusy?: boolean;
  hazardBypassCanUndo?: boolean;
  hazardBypassAtLimit?: boolean;
  onHazardBypassEnter?: () => void;
  onHazardBypassUndo?: () => void;
  onHazardBypassCancel?: () => void;
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
  onChangeDestination,
  isChangingDestination = false,
  driveMapBearingDeg,
  onRefreshTrip,
  onOpenAbout,
  onOpenTools,
  driveDistanceRemainingLabel,
  carPlayMapReturn,
  panelWidgets,
  routePickItems,
  lineFocusId,
  planRouteIds,
  previewLegIndex,
  handlePreviewRouteSelect,
  routeDockDetail,
  onAnotherWay,
  anotherWayBusy = false,
  tripBriefingPill,
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
  hazardBypassActive = false,
  hazardBypassBusy = false,
  hazardBypassCanUndo = false,
  hazardBypassAtLimit = false,
  onHazardBypassEnter,
  onHazardBypassUndo,
  onHazardBypassCancel,
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
  const tabletLandscape = useTabletLandscape();
  const stormyOn = stormyButtonFor(voiceLevel);
  const talkOn = stormyOn;
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
  const talkButton = stormyOn ? <StormyButton packet={stormyPacket} onAct={onStormyAct} /> : null;
  const placeChoices = talkOn && suggestions.length >= 2 ? suggestions.slice(0, 8) : [];
  const toolsButton = onOpenTools ? (
    <button
      type="button"
      className="nav-tools-btn"
      aria-label="StormPath Tools"
      title="StormPath Tools — trip log, ETA share, and more"
      onClick={onOpenTools}
    >
      Tools
    </button>
  ) : null;

  /* Destination / add-stop row — rendered under the about-row both while
   * planning AND while navigating in Rt/Mp, so there is always an entry
   * point to change destination or add a stop mid-route (Bill, 584). */
  const destSearchRow = (
    <div className="nav-bottom-dock__search-myloc-row">
      <div className="nav-bottom-dock__search-col">
        <div className="nav-search-dock">
          {showCompactDest ? (
            <div className="nav-dest-compact">
              <button
                type="button"
                className="nav-dest-compact--tap"
                onClick={handleCompactDestOpen}
                title="Tap to search or change destination"
              >
                <span className="nav-dest-compact-label" title={destinationLabel}>
                  {addingViaStop
                    ? "Tap map or search for a stop"
                    : isChangingDestination
                      ? "Tap map or search for a destination"
                      : destinationLabel || "Destination"}
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
              {/* Change destination lives above the info button while navigating
               * (and is unnecessary pre-Go — tapping the chip opens search). */}
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
          {/* Compact chip hides the stops list — keep stops addable/removable
           * mid-route without reopening search. Add-stop itself lives above
           * the info button, so the bar only lists + removes here. */}
          {showCompactDest && (viaStops.length > 0 || addingViaStop) ? (
            <RouteStopsBar
              viaStops={viaStops}
              addingStop={addingViaStop}
              canAddStop={canAddStop}
              onStartAddStop={onStartAddStop}
              onCancelAddStop={onCancelAddStop}
              onRemoveStop={handleRemoveViaStop}
              showAddButton={!navigationStarted}
            />
          ) : null}
        </div>
      </div>
    </div>
  );

  /* +Stop/Change pair shared by the phone MP/RT about-row and the iPad
   * landscape dock extras (mutually exclusive via CSS/branch, so one node is
   * safe). "Cancel stop" must actually disarm — while armed the button calls
   * onCancelAddStop instead of re-arming (phone field test). */
  const stopChangeButtons = (
    <>
      <button
        type="button"
        className="nav-dock-above-info-btn"
        disabled={!addingViaStop && viaStops.length >= MAX_VIA_STOPS}
        title={
          addingViaStop
            ? "Cancel adding a stop"
            : viaStops.length >= MAX_VIA_STOPS
              ? `Stop limit reached (${MAX_VIA_STOPS})`
              : "Add a stop on the way"
        }
        onClick={() => {
          if (addingViaStop) {
            onCancelAddStop();
            return;
          }
          onStartAddStop();
          if (showCompactDest) handleCompactDestOpen();
        }}
      >
        {addingViaStop ? "Cancel stop" : "+ Stop"}
      </button>
      <button
        type="button"
        className="nav-dock-above-info-btn"
        disabled={!onChangeDestination}
        title="Change destination — clears stops and replans from here"
        onClick={onChangeDestination}
      >
        Change
      </button>
    </>
  );

  /* iPad-landscape dock extras: miles-left + the mid-route shortcuts ride
   * inside the LandscapeNavigationDock controls row. The wrapper is
   * CSS-hidden everywhere except large-tablet landscape, so phone docks are
   * untouched. Order there: ⓘ · miles · +Stop · Change | Tools · compass · ↻. */
  const dockPanelExtras = (
    <div className="landscape-navigation-dock__panel-extras">
      {driveDistanceRemainingLabel ? (
        <NavMilesLeftBox label={driveDistanceRemainingLabel} />
      ) : null}
      {stopChangeButtons}
    </div>
  );

  /* MP/RT route-select strip (picker + try-another-way, or the radar clock
   * fallback). Shared by the phone about-row and the iPad panel row. */
  const mpRouteSlot = routePickItems.length >= 1 ? (
    <div className="nav-bottom-dock__route-toggle-slot nav-bottom-dock__route-toggle-slot--inline">
      <RoutePickControl
        items={routePickItems}
        selectedId={lineFocusId}
        cycleOrderIds={planRouteIds}
        activeSlotIndex={previewLegIndex}
        onSelect={handlePreviewRouteSelect}
        detail={routeDockDetail}
      />
      {onAnotherWay ? (
        <button
          type="button"
          className="nav-another-way-btn"
          aria-label="Try another route option"
          title="Try another route option"
          disabled={anotherWayBusy}
          onClick={onAnotherWay}
        >
          ⇄
        </button>
      ) : null}
    </div>
  ) : radarMapOverlayOn && radarFrameTimeLabel ? (
    <div
      className="nav-radar-frame-time-dock"
      aria-live="polite"
      title="Radar mosaic time (your local time)"
    >
      {radarFrameTimeLabel}
    </div>
  ) : null;

  /* Planning route-select strip — briefing pill + picker on one line, or the
   * My-location / radar fallbacks. iPad landscape moves it out of the
   * about-row onto its own line above the address bar (Bill, 588). */
  const planShowsPicker =
    (viewMode === "route" || viewMode === "topdown") && routePickItems.length >= 1;
  const planSlotContent =
    viewMode === "route" || viewMode === "topdown" ? (
      planShowsPicker ? (
        <div
          className={`nav-bottom-dock__route-toggle-slot nav-bottom-dock__route-toggle-slot--inline${
            !navigationStarted && tripBriefingPill
              ? " nav-bottom-dock__route-toggle-slot--with-briefing"
              : ""
          }`}
        >
          {!navigationStarted && tripBriefingPill ? (
            <div className="nav-briefing-row">{tripBriefingPill}</div>
          ) : null}
          <RoutePickControl
            items={routePickItems}
            selectedId={lineFocusId}
            cycleOrderIds={planRouteIds}
            activeSlotIndex={previewLegIndex}
            onSelect={handlePreviewRouteSelect}
            detail={routeDockDetail}
          />
          {onAnotherWay && navigationStarted && routePickItems.length >= 1 ? (
            <button
              type="button"
              className="nav-another-way-btn"
              aria-label="Try another route option"
              title="Try another route option"
              disabled={anotherWayBusy}
              onClick={onAnotherWay}
            >
              ⇄
            </button>
          ) : null}
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
    ) : null;
  const planBriefingRow =
    !navigationStarted && tripBriefingPill && !planShowsPicker ? (
      <div className="nav-briefing-row">{tripBriefingPill}</div>
    ) : null;

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
      {!trafficBypassCompareActive ? panelWidgets : null}
      {navigationStarted ? (
        <LandscapeNavigationDock miles={driveDistanceRemainingLabel} bearing={driveMapBearingDeg}
          onRefresh={
            showTripRefreshButton(navigationStarted, viewMode) && onRefreshTrip
              ? onRefreshTrip
              : undefined
          }
          onInfo={onOpenAbout} onTools={onOpenTools} panelExtras={dockPanelExtras} />
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
            <>
            <DockAboutRow
              stormyOn={talkOn}
              onOpenAbout={onOpenAbout}
              tools={toolsButton}
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
              {carPlayMapReturn}
            </DockAboutRow>
            {/* iPad gets the address bar in Drive too — phone DR stays bar-free. */}
            <div className="nav-dest-search--ipad-only">{destSearchRow}</div>
            </>
          ) : navigationStarted && (viewMode === "topdown" || viewMode === "route") ? (
            <>
            {/* CarPlay map-peek return sits directly above the route-select
             * line via routeRowAbove; the standalone row is only the fallback
             * for the no-Stormy layout where that slot isn't rendered. */}
            {carPlayMapReturn && (!talkOn || tabletLandscape) ? (
              <div className="nav-cp-return-row">{carPlayMapReturn}</div>
            ) : null}
            {tabletLandscape ? (
              /* iPad panel: ⓘ/miles/+Stop/Change live in the dock row above —
               * this row keeps Stormy + the route select only, matching DR. */
              <div className="nav-bottom-dock__about-row nav-bottom-dock__about-row--panel-mp">
                {talkButton}
                {mpRouteSlot}
              </div>
            ) : (
            <DockAboutRow
              stormyOn={talkOn}
              onOpenAbout={onOpenAbout}
              tools={toolsButton}
              stormy={talkButton}
              aboutRowClassName="nav-bottom-dock__about-row--mp"
              toolsAfterChildren
              infoAside={
                driveDistanceRemainingLabel ? (
                  <NavMilesLeftBox label={driveDistanceRemainingLabel} />
                ) : null
              }
              leadingActions={stopChangeButtons}
              routeRowAbove={carPlayMapReturn}
            >
              {mpRouteSlot}
            </DockAboutRow>
            )}
            {destSearchRow}
            </>
          ) : (
            <div className="nav-bottom-dock__plan-stack">
              {tabletLandscape ? (
                /* iPad panel planning: ⓘ far left, Tools far right on the top
                 * row; the Briefing/route-select line drops to its own row
                 * directly above the address bar (Bill, 588). */
                <>
                  <div className="nav-bottom-dock__about-row nav-bottom-dock__about-row--panel-plan">
                    <MapInfoButton onOpenAbout={onOpenAbout} />
                    <div className="nav-bottom-dock__panel-plan-tools">
                      {talkButton}
                      {toolsButton}
                    </div>
                  </div>
                  {planSlotContent}
                  {planBriefingRow}
                  {destSearchRow}
                </>
              ) : (
                <>
                  {/* About row: 'i' on the left; route-info cycle chip or My location in the inline slot. */}
                  <DockAboutRow
                    stormyOn={talkOn}
                    onOpenAbout={onOpenAbout}
                    tools={toolsButton}
                    stormy={talkButton}
                  >
                    {planSlotContent}
                  </DockAboutRow>
                  {planBriefingRow}
                  {destSearchRow}
                </>
              )}
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
          hazardBypassActive={hazardBypassActive}
          hazardBypassBusy={hazardBypassBusy}
          hazardBypassCanUndo={hazardBypassCanUndo}
          hazardBypassAtLimit={hazardBypassAtLimit}
          onHazardBypassEnter={onHazardBypassEnter}
          onHazardBypassUndo={onHazardBypassUndo}
          onHazardBypassCancel={onHazardBypassCancel}
        />
      </div>
      ) : null}
    </div>
  );
}
