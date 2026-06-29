import { useMemo } from "react";
import type { CurrentNowcast } from "../services/openWeatherClient";
import type { MinutePrecipForecast, PointDailyForecast, PointHourlyForecast } from "../services/tomorrowIo";
import type { NormalizedWeatherAlert } from "../weatherAlerts/types";
import {
  dedupeNwsAlertsForDisplay,
  isHeatRelatedNwsAlert,
} from "../weatherAlerts/localForecastNws";
import { nwsGlanceSummary } from "../weatherAlerts/nwsDriveSummary";
import {
  feelsLikeCellColor,
  formatHeatIndexLine,
  heatIndexNotable,
  heatStressLabel,
  hourComfortCallout,
  dailyPrecipBadge,
  precipDisplayLabel,
  precipIsActive,
  precipTypeColor,
  resolveHourFeelsLikeF,
  uvIndexColor,
  type PrecipTypeCode,
} from "../forecast/localForecastVisual";
import {
  formatDailyDayLabel,
  formatForecastUpdatedAt,
  formatMinutePrecipNowLine,
  latestForecastFetchedAtMs,
} from "../utils/forecastDisplay";
import {
  buildNextHourLanes,
  formatHourlySlotTimeLabel,
  hourlyPrecipForDisplay,
  hourlyStripHeadline,
  nextHourHeadline,
  nextHourPeakFeels,
  upcomingHourlySlots,
} from "../forecast/localForecastStrips";

function nwsRowSeverityClass(a: NormalizedWeatherAlert): string {
  if (a.severity === "Extreme" || /tornado warning/i.test(a.event ?? "")) return "avoid";
  if (a.severity === "Severe" || /warning/i.test(a.event ?? "")) return "serious";
  if (a.severity === "Moderate") return "caution";
  return "info";
}

function titleCase(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function localProviderLabel(opts: {
  weatherKitPrimary: boolean;
  hourly?: PointHourlyForecast | null;
  daily?: PointDailyForecast | null;
  hasNowcast: boolean;
}): string {
  if (opts.weatherKitPrimary) return "WeatherKit";
  if (opts.hourly?.provider === "weatherKit" || opts.daily?.provider === "weatherKit") return "WeatherKit";
  if (opts.hourly?.provider === "openWeather") return "OpenWeather";
  if (opts.hasNowcast) return "OpenWeather";
  return "Forecast";
}

type Props = {
  areaLabel: string;
  nowcast?: CurrentNowcast | null;
  minutePrecip?: MinutePrecipForecast | null;
  hourlyForecast?: PointHourlyForecast | null;
  dailyForecast?: PointDailyForecast | null;
  locationAlerts?: NormalizedWeatherAlert[];
  nwsLoading?: boolean;
  nwsError?: string | null;
  onLocationAlertClick?: (alert: NormalizedWeatherAlert) => void;
  variant?: "full" | "basic";
  forecastLoading?: boolean;
  weatherKitPrimary?: boolean;
};

export function AdvisoryLocalForecast({
  areaLabel,
  nowcast,
  minutePrecip,
  hourlyForecast,
  dailyForecast,
  locationAlerts = [],
  nwsLoading = false,
  nwsError = null,
  onLocationAlertClick,
  variant = "full",
  forecastLoading = false,
  weatherKitPrimary = false,
}: Props) {
  const isBasic = variant === "basic";
  const provider = localProviderLabel({
    weatherKitPrimary,
    hourly: hourlyForecast,
    daily: dailyForecast,
    hasNowcast: Boolean(nowcast),
  });

  const hours = hourlyForecast?.hours ?? [];
  const days = dailyForecast?.days ?? [];
  const hasNow = Boolean(nowcast || minutePrecip?.now);
  const hasNextHour = !isBasic && (Boolean(minutePrecip?.minutes.length) || hours.length > 0);
  const hasDay = hours.length > 0;
  const hasMultiDay = !isBasic && days.length > 0;
  const showWeekSection =
    !isBasic && (hasMultiDay || (weatherKitPrimary && forecastLoading && !days.length));
  const showNwsBlock = !isBasic && (locationAlerts.length > 0 || nwsLoading || Boolean(nwsError?.trim()));

  const metaUpdated = useMemo(() => {
    const ms = latestForecastFetchedAtMs(
      nowcast?.fetchedAtMs,
      minutePrecip?.fetchedAt,
      hourlyForecast?.fetchedAt,
      dailyForecast?.fetchedAt
    );
    return ms != null ? formatForecastUpdatedAt(ms) : null;
  }, [nowcast?.fetchedAtMs, minutePrecip?.fetchedAt, hourlyForecast?.fetchedAt, dailyForecast?.fetchedAt]);

  const hourSamples = useMemo(() => upcomingHourlySlots(hours, 24), [hours]);

  const nextHourLanes = useMemo(
    () => buildNextHourLanes({ nowcast, minutePrecip, hours }),
    [nowcast, minutePrecip, hours]
  );

  const nextHourSummary = useMemo(
    () => nextHourHeadline({ nowcast, minutePrecip, hours }),
    [nowcast, minutePrecip, hours]
  );

  const dayStripSummary = useMemo(() => hourlyStripHeadline(hours), [hours]);

  const nextHourHeatLine = useMemo(() => {
    const peak = nextHourPeakFeels({ nowcast, hours });
    if (!heatIndexNotable(peak)) return null;
    return formatHeatIndexLine(peak);
  }, [nowcast, hours]);

  const dayHeatPeakLine = useMemo(() => {
    let maxFeels = -Infinity;
    for (const h of hourSamples) {
      maxFeels = Math.max(maxFeels, resolveHourFeelsLikeF(h));
    }
    if (!Number.isFinite(maxFeels) || !heatIndexNotable(maxFeels)) return null;
    return formatHeatIndexLine(maxFeels);
  }, [hourSamples]);

  const nowHeatLine = useMemo(() => {
    const feels = nowcast?.feelsLikeF;
    if (feels == null || !heatIndexNotable(feels)) return null;
    return formatHeatIndexLine(feels);
  }, [nowcast?.feelsLikeF]);

  const displayLocationAlerts = useMemo(() => {
    let alerts = dedupeNwsAlertsForDisplay(locationAlerts);
    if (nowHeatLine) {
      alerts = alerts.filter((a) => !isHeatRelatedNwsAlert(a));
    }
    return alerts;
  }, [locationAlerts, nowHeatLine]);

  const hasNws = displayLocationAlerts.length > 0;

  if (isBasic) {
    if (!hasNow && !hasDay && !forecastLoading) return null;
  } else if (!hasNow && !hasNextHour && !hasDay && !showWeekSection && !showNwsBlock && !forecastLoading) {
    return null;
  }

  const heroTemp = nowcast?.tempF ?? minutePrecip?.now?.tempF;
  const heroConditions = nowcast?.conditions
    ? titleCase(nowcast.conditions)
    : minutePrecip?.now?.conditions
      ? titleCase(minutePrecip.now.conditions)
      : null;

  return (
    <section className="adv-dash adv-dash--here" aria-label={`Weather at ${areaLabel}`}>
      <header className="adv-dash__zone">
        <div className="adv-dash__zone-main">
          <span className="adv-dash__zone-tag">Here</span>
          <span className="adv-dash__zone-place">{areaLabel}</span>
        </div>
        <span className="adv-dash__zone-meta" title={provider}>
          {metaUpdated ?? provider}
        </span>
      </header>

      {forecastLoading && !hasNow && !hasNextHour && !hasDay && !showWeekSection ? (
        <p className="adv-dash__empty adv-dash__block adv-dash__block--now">Loading forecast</p>
      ) : null}

      {(hasNow && heroTemp != null) || showNwsBlock ? (
        <div className="adv-dash__block adv-dash__block--now">
          {hasNow && heroTemp != null ? (
        <div className="adv-dash__hero">
          <div className="adv-dash__hero-temp" aria-hidden>
            {heroTemp}
            <span className="adv-dash__hero-degree">°</span>
          </div>
          <div className="adv-dash__hero-body">
            {heroConditions ? <p className="adv-dash__hero-sky">{heroConditions}</p> : null}
            <div className="adv-dash__stat-grid">
              {nowcast &&
              (heatIndexNotable(nowcast.feelsLikeF) ||
                Math.abs(nowcast.feelsLikeF - nowcast.tempF) >= 3) ? (
                <div className="adv-dash__stat">
                  <span className="adv-dash__stat-k">Feels like</span>
                  <span
                    className="adv-dash__stat-v"
                    style={{ color: heatIndexNotable(nowcast.feelsLikeF) ? feelsLikeCellColor(nowcast.feelsLikeF) : undefined }}
                  >
                    {nowcast.feelsLikeF}°
                  </span>
                </div>
              ) : null}
              {nowcast && nowcast.windMph >= 1 ? (
                <div className="adv-dash__stat">
                  <span className="adv-dash__stat-k">Wind</span>
                  <span className="adv-dash__stat-v">
                    {nowcast.windGustMph != null && nowcast.windGustMph >= nowcast.windMph + 8
                      ? `${nowcast.windMph} to ${nowcast.windGustMph}`
                      : nowcast.windMph}
                    <span className="adv-dash__stat-u"> miles per hour</span>
                  </span>
                </div>
              ) : null}
              {nowcast?.uvIndex != null && nowcast.uvIndex >= 3 ? (
                <div className="adv-dash__stat">
                  <span className="adv-dash__stat-k">UV</span>
                  <span className="adv-dash__stat-v" style={{ color: uvIndexColor(nowcast.uvIndex) }}>
                    {Math.round(nowcast.uvIndex)}
                  </span>
                </div>
              ) : null}
              {nowcast?.humidityPct != null && nowcast.tempF >= 75 ? (
                <div className="adv-dash__stat">
                  <span className="adv-dash__stat-k">Humidity</span>
                  <span className="adv-dash__stat-v">{nowcast.humidityPct}%</span>
                </div>
              ) : null}
            </div>
            {nowHeatLine ? <p className="adv-dash__heat-callout">{nowHeatLine}</p> : null}
            {!nowcast && minutePrecip?.now ? (
              <p className="adv-dash__hero-fallback">{formatMinutePrecipNowLine(minutePrecip.now)}</p>
            ) : null}
          </div>
        </div>
          ) : null}

      {showNwsBlock && hasNws ? (
        <ul className="adv-dash__local-alerts" role="list">
          {displayLocationAlerts.map((a) => {
            const label = a.event?.trim() || "Alert";
            const sev = nwsRowSeverityClass(a);
            const detail = nwsGlanceSummary(a);
            return (
              <li key={a.id}>
                {onLocationAlertClick ? (
                  <button
                    type="button"
                    className={`adv-dash__local-alert adv-dash__local-alert--${sev}`}
                    onClick={() => onLocationAlertClick(a)}
                  >
                    <span className="adv-dash__local-alert-tag">NWS</span>
                    <span className="adv-dash__local-alert-text">
                      {label}
                      {detail ? ` · ${detail}` : ""}
                    </span>
                  </button>
                ) : (
                  <p className={`adv-dash__local-alert adv-dash__local-alert--static adv-dash__local-alert--${sev}`}>
                    <span className="adv-dash__local-alert-tag">NWS</span>
                    <span className="adv-dash__local-alert-text">{label}</span>
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      ) : showNwsBlock && nwsLoading ? (
        <p className="adv-dash__empty">Checking National Weather Service alerts</p>
      ) : null}
        </div>
      ) : null}

      <div className="adv-dash__strips">
        {hasNextHour ? (
          <div
            className={`adv-dash__block adv-dash__block--hour adv-dash__strip adv-dash__strip--micro${
              nextHourHeatLine ? " adv-dash__strip--heat" : ""
            }`}
          >
            <div className="adv-dash__strip-head">
              <span className="adv-dash__strip-label">Next hour</span>
              <span className="adv-dash__strip-answer">{nextHourSummary}</span>
            </div>
            {nextHourHeatLine ? (
              <p className="adv-dash__heat-callout">{nextHourHeatLine}</p>
            ) : null}
            <div className="adv-dash__lane-legend" aria-hidden>
              <span className="adv-dash__legend-swatch adv-dash__legend-swatch--heat">Heat index</span>
              <span className="adv-dash__legend-swatch adv-dash__legend-swatch--rain">Rain or snow</span>
              <span className="adv-dash__legend-swatch adv-dash__legend-swatch--wind">Wind</span>
            </div>
            <div className="adv-dash__micro-stack" aria-label="Next hour at a glance">
              <div className="adv-dash__bar adv-dash__bar--lane" aria-hidden>
                {nextHourLanes.map((cell, i) => (
                  <div
                    key={`heat-${i}`}
                    className="adv-dash__bar-cell"
                    style={{ background: cell.heatColor }}
                  />
                ))}
              </div>
              <div className="adv-dash__bar adv-dash__bar--lane" aria-hidden>
                {nextHourLanes.map((cell, i) => (
                  <div
                    key={`precip-${i}`}
                    className="adv-dash__bar-cell"
                    style={{ background: cell.precipColor }}
                  />
                ))}
              </div>
              <div className="adv-dash__wind-lane" aria-hidden>
                {nextHourLanes.map((cell, i) => (
                  <div key={`wind-${i}`} className="adv-dash__wind-cell">
                    <span
                      className="adv-dash__wind-fill"
                      style={{ height: cell.windHeightPct, background: cell.windColor }}
                    />
                  </div>
                ))}
              </div>
            </div>
            <div className="adv-dash__micro-axis" aria-hidden>
              <span>Now</span>
              <span>15 min</span>
              <span>30 min</span>
              <span>45 min</span>
              <span>60 min</span>
            </div>
          </div>
        ) : null}

        {hasDay && !isBasic ? (
          <div
            className={`adv-dash__block adv-dash__block--day adv-dash__strip adv-dash__strip--day${
              dayHeatPeakLine ? " adv-dash__strip--heat" : ""
            }`}
          >
            <div className="adv-dash__strip-head">
              <span className="adv-dash__strip-label">Next 24 hours</span>
              <span className="adv-dash__strip-answer">{dayStripSummary}</span>
            </div>
            {dayHeatPeakLine ? (
              <p className="adv-dash__heat-callout">{dayHeatPeakLine}</p>
            ) : null}
            <div className="adv-dash__lane-legend" aria-hidden>
              <span className="adv-dash__legend-swatch adv-dash__legend-swatch--heat">Color = heat index (or wind chill)</span>
              <span className="adv-dash__legend-swatch adv-dash__legend-swatch--rain">Bottom stripe = rain or snow</span>
            </div>
            <div className="adv-dash__hour-scroll" role="img" aria-label={`Hourly forecast at ${areaLabel}`}>
              <div className="adv-dash__hour-row">
                {hourSamples.map((h) => {
                  const feels = resolveHourFeelsLikeF(h);
                  const air = Math.round(h.tempF);
                  const gust = h.windGustMph ?? h.windMph ?? 0;
                  const comfort = hourComfortCallout(feels, air, gust);
                  const timeLabel = formatHourlySlotTimeLabel(h.timeIso);
                  const isNowSlot = timeLabel === "Now";
                  const minutePrecipActive = Boolean(
                    minutePrecip?.minutes
                      .slice(0, 15)
                      .some((m) =>
                        precipIsActive(
                          m.precipIntensityMmh,
                          m.precipProbability,
                          m.precipType as PrecipTypeCode
                        )
                      )
                  );
                  const precip = hourlyPrecipForDisplay(h, {
                    isNowSlot,
                    nowPrecipMmh:
                      nowcast?.precipInPerHr != null ? nowcast.precipInPerHr * 25.4 : null,
                    minutePrecipActive: minutePrecip ? minutePrecipActive : undefined,
                  });
                  const precipLabel = precipDisplayLabel(
                    precip.type,
                    precip.intensityMmh,
                    precip.probability
                  );
                  const precipColor = precipTypeColor(
                    precip.type,
                    precip.intensityMmh,
                    precip.probability
                  );
                  return (
                    <div
                      key={h.timeIso}
                      className={`adv-dash__hour-card${
                        comfort.kind === "heat" ? " adv-dash__hour-card--heat" : ""
                      }${comfort.kind === "cold" ? " adv-dash__hour-card--cold" : ""}${
                        precip.active ? " adv-dash__hour-card--wet" : ""
                      }`}
                      style={{
                        background: feelsLikeCellColor(feels),
                        borderBottomColor: precip.active ? precipColor : "transparent",
                      }}
                      title={`${timeLabel}: feels like ${feels}°${
                        air !== feels ? `, air ${air}°` : ""
                      }${comfort.label ? `, ${comfort.label}` : ""}${
                        precipLabel ? `, ${precipLabel}` : ", dry"
                      }${gust >= 18 ? `, gusts to ${Math.round(gust)} mph` : ""}`}
                    >
                      <span className="adv-dash__hour-time">{timeLabel}</span>
                      <span className="adv-dash__hour-temp">{feels}°</span>
                      {comfort.label ? (
                        <span
                          className={
                            comfort.kind === "cold" ? "adv-dash__hour-cold" : "adv-dash__hour-heat"
                          }
                        >
                          {comfort.label}
                        </span>
                      ) : null}
                      {comfort.kind === "heat" && air !== feels ? (
                        <span className="adv-dash__hour-air">Air {air}°</span>
                      ) : null}
                      {comfort.kind === "cold" && air !== feels ? (
                        <span className="adv-dash__hour-air">Air {air}°</span>
                      ) : null}
                      {precipLabel ? (
                        <span
                          className="adv-dash__hour-precip-tag"
                          style={{
                            borderColor: precipTypeColor(
                              precip.type,
                              precip.intensityMmh,
                              precip.probability
                            ),
                          }}
                        >
                          {precipLabel}
                        </span>
                      ) : null}
                      {gust >= 18 ? (
                        <span className="adv-dash__hour-wind-tag">Wind {Math.round(gust)}</span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}

        {hasDay && isBasic ? (
          <div className="adv-dash__block adv-dash__block--day adv-dash__strip">
            <div className="adv-dash__strip-head">
              <span className="adv-dash__strip-label">Outlook</span>
            </div>
            <p className="adv-dash__strip-note">
              {Math.round(hours[0]?.feelsLikeF ?? hours[0]?.tempF ?? 0)}° now · check expanded view for detail
            </p>
          </div>
        ) : null}

        {hasMultiDay ? (
          <div className="adv-dash__block adv-dash__block--week adv-dash__strip adv-dash__strip--week">
            <div className="adv-dash__strip-head">
              <span className="adv-dash__strip-label">Next seven days</span>
            </div>
            <div className="adv-dash__week-scroll" role="img" aria-label={`Daily forecast at ${areaLabel}`}>
              <div className="adv-dash__week-row">
                {days.slice(0, 7).map((d, i) => {
                  const peakFeels = d.maxFeelsLikeF;
                  const heatLabel = peakFeels != null ? heatStressLabel(peakFeels) : null;
                  return (
                  <div
                    key={d.dateIso}
                    className={`adv-dash__week-cell${heatLabel ? " adv-dash__week-cell--heat" : ""}`}
                  >
                    <span className="adv-dash__week-day">{formatDailyDayLabel(d, i)}</span>
                    <span className="adv-dash__week-hi">{d.highF}° high</span>
                    <span className="adv-dash__week-lo">{d.lowF}° low</span>
                    {heatLabel && peakFeels != null ? (
                      <span
                        className="adv-dash__week-heat"
                        style={{ borderColor: feelsLikeCellColor(peakFeels) }}
                      >
                        Heat index {peakFeels}° · {heatLabel}
                      </span>
                    ) : d.maxFeelsLikeF != null && d.maxFeelsLikeF > d.highF + 2 ? (
                      <span className="adv-dash__week-heat adv-dash__week-heat--mild">
                        Feels like up to {d.maxFeelsLikeF}°
                      </span>
                    ) : null}
                    {d.daytimeConditions ? (
                      <span className="adv-dash__week-cond">{d.daytimeConditions}</span>
                    ) : null}
                    {(() => {
                      const precipBadge = dailyPrecipBadge(d);
                      if (!precipBadge) return null;
                      return (
                      <span
                        className="adv-dash__week-precip"
                        style={{
                          borderColor: precipTypeColor(
                            precipBadge.type,
                            d.snowfallCm ? 2 : 0,
                            d.precipChance
                          ),
                        }}
                      >
                        {precipBadge.label}
                      </span>
                      );
                    })()}
                  </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : showWeekSection ? (
          <div className="adv-dash__block adv-dash__block--week adv-dash__strip adv-dash__strip--week">
            <div className="adv-dash__strip-head">
              <span className="adv-dash__strip-label">Next seven days</span>
            </div>
            <p className="adv-dash__strip-note">Loading daily forecast from WeatherKit</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
