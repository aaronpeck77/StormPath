import type { StormAdvisoryBarProps } from "./StormAdvisoryBar";
import type { AdvisoryExpandedModel } from "./advisoryExpandedModel";
import { AdvisoryLocalForecast } from "./AdvisoryLocalForecast";
import { AdvisoryRouteHazardsPanel } from "./AdvisoryRouteHazardsPanel";
import { BasicAdStrip } from "./BasicAdStrip";
import {
  DATA_SAVER_ADVISORY_DETAIL,
} from "../utils/dataSaver";

/**
 * The scrollable body of the expanded advisory panel — local forecast
 * (Now / 24-hour / 7-day) plus the route hazards feed. Rendered inside
 * {@link StormAdvisoryBar}'s fixed panel on the map view and inline on the
 * CarPlay companion page so both surfaces show identical content.
 */
export function AdvisoryExpandedSections({
  p,
  model,
}: {
  p: StormAdvisoryBarProps;
  model: AdvisoryExpandedModel;
}) {
  const {
    basicNavAdvisoryMode = false,
    forecastAreaLabel = null,
    currentNowcast = null,
    nowcastLine = null,
    minutePrecipForecast = null,
    hourlyForecast = null,
    dailyForecast = null,
    localForecastNwsAlerts = [],
    nwsForecastLoading = false,
    nwsForecastError = null,
    onNwsAlertClick,
    basicForecastLoading = false,
    weatherKitPrimary = false,
    forecastLngLat = null,
    navigationStarted,
    hasGuidanceRoute,
    barExpanded,
    sessionOn,
    roadDetailEnabled,
    roadDetailRows,
    routeTotalMeters = 0,
    userAlongMeters = 0,
    planEtaMinutes = null,
    driveEtaMinutes = null,
    onTrafficReroute,
    trafficRerouteBusy = false,
    dataSaverHint = null,
    basicStatusPanelPromos = null,
    onOpenSubscription,
  } = p;

  return (
    <div className="storm-advisory-bar__sections-scroll">
      {basicNavAdvisoryMode &&
      forecastAreaLabel &&
      (currentNowcast || nowcastLine || basicForecastLoading) ? (
        <AdvisoryLocalForecast
          areaLabel={forecastAreaLabel}
          nowcast={currentNowcast}
          minutePrecip={null}
          hourlyForecast={null}
          dailyForecast={null}
          locationAlerts={[]}
          nwsLoading={false}
          nwsError={null}
          variant="basic"
          forecastLoading={basicForecastLoading}
          weatherKitPrimary={weatherKitPrimary}
          forecastLngLat={forecastLngLat}
        />
      ) : null}

      {basicNavAdvisoryMode && basicStatusPanelPromos ? (
        <div
          className="storm-advisory-bar__basic-promos"
          aria-label="StormPath Plus"
        >
          <BasicAdStrip
            lines={[basicStatusPanelPromos.plusUpsell]}
            expanded
            className="storm-advisory-bar__basic-strip storm-advisory-bar__basic-strip--plus"
            aria-label="StormPath Plus upgrade"
            onOpenSubscription={onOpenSubscription}
          />
        </div>
      ) : basicNavAdvisoryMode && model.expandedPromoLines.length > 0 ? (
        <BasicAdStrip
          lines={model.expandedPromoLines}
          expanded
          aria-label="StormPath Plus and partner offers"
          onOpenSubscription={onOpenSubscription}
        />
      ) : null}

      {forecastAreaLabel &&
      !basicNavAdvisoryMode &&
      (currentNowcast ||
        minutePrecipForecast ||
        hourlyForecast?.hours.length ||
        dailyForecast?.days.length ||
        localForecastNwsAlerts.length > 0 ||
        nwsForecastLoading ||
        basicForecastLoading) ? (
        <AdvisoryLocalForecast
          areaLabel={forecastAreaLabel}
          nowcast={currentNowcast}
          minutePrecip={minutePrecipForecast}
          hourlyForecast={hourlyForecast}
          dailyForecast={dailyForecast}
          locationAlerts={localForecastNwsAlerts}
          nwsLoading={nwsForecastLoading}
          nwsError={nwsForecastError}
          onLocationAlertClick={onNwsAlertClick}
          variant="full"
          forecastLoading={basicForecastLoading}
          weatherKitPrimary={weatherKitPrimary}
          forecastLngLat={forecastLngLat}
        />
      ) : null}

      {!basicNavAdvisoryMode ? (
        <>
          {forecastAreaLabel &&
          (currentNowcast ||
            minutePrecipForecast ||
            hourlyForecast?.hours.length ||
            dailyForecast?.days.length ||
            localForecastNwsAlerts.length > 0 ||
            nwsForecastLoading ||
            basicForecastLoading) ? (
            <div className="adv-dash__split" role="separator" aria-hidden />
          ) : null}

          <AdvisoryRouteHazardsPanel
            navigationStarted={navigationStarted}
            hasGuidanceRoute={hasGuidanceRoute}
            barExpanded={barExpanded}
            sessionOn={sessionOn}
            roadDetailEnabled={roadDetailEnabled}
            urgentTopAlerts={model.urgentTopAlerts}
            alongRouteDetailRows={roadDetailRows}
            hasRouteHazardDetail={model.hasRouteHazardDetail}
            advisoryRouteTimeline={model.advisoryRouteTimeline}
            routeTotalMeters={routeTotalMeters}
            userAlongMeters={userAlongMeters}
            planEtaMinutes={planEtaMinutes}
            driveEtaMinutes={driveEtaMinutes}
            showRerouteCta={model.showRerouteCta}
            onTrafficReroute={onTrafficReroute}
            trafficRerouteBusy={trafficRerouteBusy}
            nwsStatusMessage={model.nwsStatusMessage}
            developingNwsAlerts={model.developingNwsAlerts}
            panelNwsAlertsExtra={model.panelNwsAlertsExtra}
            onNwsAlertClick={onNwsAlertClick}
          />

          <div className="storm-advisory-bar__dashboard">
          {dataSaverHint ? (
            <div
              className="storm-advisory-bar__suggestion-row storm-advisory-bar__suggestion-row--data-saver"
              role="note"
            >
              <span className="storm-advisory-bar__suggestion-label">Data saver</span>
              <span className="storm-advisory-bar__suggestion-text">{DATA_SAVER_ADVISORY_DETAIL}</span>
              <button
                type="button"
                className="storm-advisory-bar__btn storm-advisory-bar__btn--traffic"
                onClick={dataSaverHint.onOpenSettings}
              >
                About
              </button>
              <button
                type="button"
                className="storm-advisory-bar__suggestion-row-dismiss"
                onClick={dataSaverHint.onDismiss}
                aria-label="Dismiss data saver tip"
                title="Dismiss"
              >
                ×
              </button>
            </div>
          ) : null}

        </div>
        </>
      ) : null}
    </div>
  );
}
