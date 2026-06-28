import { useMemo } from "react";
import type { CurrentNowcast } from "../services/openWeatherClient";
import type { MinutePrecipForecast, PointDailyForecast, PointHourlyForecast } from "../services/tomorrowIo";
import type { NormalizedWeatherAlert } from "../weatherAlerts/types";
import { nwsGlanceSummary } from "../weatherAlerts/nwsDriveSummary";
import {
  precipTypeColor,
  precipTypeShortLabel,
  uvIndexColor,
  type PrecipTypeCode,
} from "../forecast/localForecastVisual";
import {
  formatDailyDayLabel,
  formatForecastUpdatedAt,
  formatLocalForecastHourLabel,
  formatMinutePrecipNowLine,
  latestForecastFetchedAtMs,
} from "../utils/forecastDisplay";
import { formatEtaDuration } from "./formatEta";

function nwsRowSeverityClass(a: NormalizedWeatherAlert): string {
  if (a.severity === "Extreme" || /tornado warning/i.test(a.event ?? "")) return "avoid";
  if (a.severity === "Severe" || /warning/i.test(a.event ?? "")) return "serious";
  if (a.severity === "Moderate") return "caution";
  return "info";
}

function minuteHeadline(forecast: MinutePrecipForecast): string {
  const minutes = forecast.minutes.slice(0, 60);
  const hasAnyPrecip = minutes.some((m) => m.precipIntensityMmh > 0 || m.precipProbability > 0.1);
  const firstWet = minutes.findIndex((m) => m.precipIntensityMmh > 0.1);
  if (!hasAnyPrecip) return "Dry";
  if (firstWet <= 0) return "Precip now";
  if (firstWet <= 10) return `Precip in ~${formatEtaDuration(firstWet)}`;
  return `Precip ~${formatEtaDuration(firstWet)}`;
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

/** Sample hourly columns — every 2 hours keeps the strip readable on phone. */
function sampledHours(hours: PointHourlyForecast["hours"], step = 2) {
  if (hours.length <= 8) return hours.map((h, i) => ({ h, i }));
  const out: { h: (typeof hours)[number]; i: number }[] = [];
  for (let i = 0; i < hours.length; i += step) out.push({ h: hours[i]!, i });
  const last = hours.length - 1;
  if (out[out.length - 1]?.i !== last) out.push({ h: hours[last]!, i: last });
  return out;
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
  const hasHour = !isBasic && Boolean(minutePrecip?.minutes.length);
  const hasDay = hours.length > 0;
  const hasMultiDay = !isBasic && days.length > 0;
  const hasNws = locationAlerts.length > 0;
  const showNwsBlock = !isBasic && (hasNws || nwsLoading || Boolean(nwsError?.trim()));

  const metaUpdated = useMemo(() => {
    const ms = latestForecastFetchedAtMs(
      nowcast?.fetchedAtMs,
      minutePrecip?.fetchedAt,
      hourlyForecast?.fetchedAt,
      dailyForecast?.fetchedAt
    );
    return ms != null ? formatForecastUpdatedAt(ms) : null;
  }, [nowcast?.fetchedAtMs, minutePrecip?.fetchedAt, hourlyForecast?.fetchedAt, dailyForecast?.fetchedAt]);

  const hourSamples = useMemo(() => sampledHours(hours), [hours]);

  if (isBasic) {
    if (!hasNow && !hasDay && !forecastLoading) return null;
  } else if (!hasNow && !hasHour && !hasDay && !hasMultiDay && !showNwsBlock && !forecastLoading) {
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

      {forecastLoading && !hasNow && !hasHour && !hasDay ? (
        <p className="adv-dash__empty">Loading…</p>
      ) : null}

      {hasNow && heroTemp != null ? (
        <div className="adv-dash__hero">
          <div className="adv-dash__hero-temp" aria-hidden>
            {heroTemp}
            <span className="adv-dash__hero-degree">°</span>
          </div>
          <div className="adv-dash__hero-body">
            {heroConditions ? <p className="adv-dash__hero-sky">{heroConditions}</p> : null}
            <div className="adv-dash__stat-grid">
              {nowcast && Math.abs(nowcast.feelsLikeF - nowcast.tempF) >= 3 ? (
                <div className="adv-dash__stat">
                  <span className="adv-dash__stat-k">Feels</span>
                  <span className="adv-dash__stat-v">{nowcast.feelsLikeF}°</span>
                </div>
              ) : null}
              {nowcast && nowcast.windMph >= 1 ? (
                <div className="adv-dash__stat">
                  <span className="adv-dash__stat-k">Wind</span>
                  <span className="adv-dash__stat-v">
                    {nowcast.windGustMph != null && nowcast.windGustMph >= nowcast.windMph + 8
                      ? `${nowcast.windMph}→${nowcast.windGustMph}`
                      : nowcast.windMph}
                    <span className="adv-dash__stat-u"> mph</span>
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
                  <span className="adv-dash__stat-k">Humid</span>
                  <span className="adv-dash__stat-v">{nowcast.humidityPct}%</span>
                </div>
              ) : null}
            </div>
            {!nowcast && minutePrecip?.now ? (
              <p className="adv-dash__hero-fallback">{formatMinutePrecipNowLine(minutePrecip.now)}</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {showNwsBlock && hasNws ? (
        <ul className="adv-dash__local-alerts" role="list">
          {locationAlerts.map((a) => {
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
        <p className="adv-dash__empty">Checking NWS…</p>
      ) : null}

      <div className="adv-dash__strips">
        {hasHour && minutePrecip ? (
          <div className="adv-dash__strip">
            <div className="adv-dash__strip-head">
              <span className="adv-dash__strip-label">Next hour</span>
              <span className="adv-dash__strip-answer">{minuteHeadline(minutePrecip)}</span>
            </div>
            <div className="adv-dash__bar" aria-label="Precipitation next 60 minutes">
              {minutePrecip.minutes.slice(0, 60).map((m, i) => (
                <div
                  key={i}
                  className="adv-dash__bar-cell"
                  style={{
                    background: precipTypeColor(
                      m.precipType as PrecipTypeCode,
                      m.precipIntensityMmh,
                      m.precipProbability
                    ),
                  }}
                />
              ))}
            </div>
          </div>
        ) : null}

        {hasDay && !isBasic ? (
          <div className="adv-dash__strip">
            <div className="adv-dash__strip-head">
              <span className="adv-dash__strip-label">Today</span>
              <span className="adv-dash__strip-answer">Hourly</span>
            </div>
            <div className="adv-dash__hour-scroll" role="img" aria-label={`Hourly forecast at ${areaLabel}`}>
              <div className="adv-dash__hour-row">
                {hourSamples.map(({ h, i }) => (
                  <div key={h.timeIso} className="adv-dash__hour-cell">
                    <span className="adv-dash__hour-time">{formatLocalForecastHourLabel(h.offsetHours, i)}</span>
                    <span className="adv-dash__hour-temp">{Math.round(h.feelsLikeF ?? h.tempF)}°</span>
                    <span
                      className="adv-dash__hour-precip"
                      style={{
                        background: precipTypeColor(
                          h.precipType as PrecipTypeCode,
                          h.precipIntensityMmh,
                          h.precipProbability
                        ),
                      }}
                      title={precipTypeShortLabel(h.precipType as PrecipTypeCode)}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {hasDay && isBasic ? (
          <div className="adv-dash__strip">
            <div className="adv-dash__strip-head">
              <span className="adv-dash__strip-label">Outlook</span>
            </div>
            <p className="adv-dash__strip-note">
              {Math.round(hours[0]?.feelsLikeF ?? hours[0]?.tempF ?? 0)}° now · check expanded view for detail
            </p>
          </div>
        ) : null}

        {hasMultiDay ? (
          <div className="adv-dash__strip">
            <div className="adv-dash__strip-head">
              <span className="adv-dash__strip-label">Week</span>
            </div>
            <div className="adv-dash__week-scroll" role="img" aria-label={`Daily forecast at ${areaLabel}`}>
              <div className="adv-dash__week-row">
                {days.slice(0, 7).map((d, i) => (
                  <div key={d.dateIso} className="adv-dash__week-cell">
                    <span className="adv-dash__week-day">{formatDailyDayLabel(d, i)}</span>
                    <span className="adv-dash__week-hi">{d.highF}°</span>
                    <span className="adv-dash__week-lo">{d.lowF}°</span>
                    {(d.precipChance > 0.12 || (d.precipType ?? 0) > 0) && (
                      <span
                        className="adv-dash__week-dot"
                        style={{
                          background: precipTypeColor(
                            d.precipType as PrecipTypeCode,
                            d.snowfallCm ? 2 : 0,
                            d.precipChance
                          ),
                        }}
                        title={d.snowfallCm ? "Snow" : precipTypeShortLabel(d.precipType as PrecipTypeCode)}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
