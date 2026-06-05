import { useMemo } from "react";
import type { CurrentNowcast } from "../services/openWeatherClient";
import { formatNowcastLine } from "../services/openWeatherClient";
import type { MinutePrecipForecast, PointHourlyForecast } from "../services/tomorrowIo";
import type { NormalizedWeatherAlert } from "../weatherAlerts/types";
import { nwsGlanceSummary } from "../weatherAlerts/nwsDriveSummary";
import {
  formatForecastUpdatedAt,
  formatLocalForecastHourLabel,
  formatMinutePrecipNowLine,
  latestForecastFetchedAtMs,
  pointHourlyForecastSummary,
} from "../utils/forecastDisplay";
import { formatEtaDuration } from "./formatEta";

function precipColor(mmh: number, prob: number): string {
  const effective = mmh * Math.max(0.3, prob);
  if (effective === 0) return "rgba(148, 163, 184, 0.12)";
  if (effective < 0.1) return "#93c5fd";
  if (effective < 0.5) return "#60a5fa";
  if (effective < 2.5) return "#3b82f6";
  if (effective < 7.5) return "#7c3aed";
  return "#ef4444";
}

function nwsRowSeverityClass(a: NormalizedWeatherAlert): string {
  if (a.severity === "Extreme" || /tornado warning/i.test(a.event ?? "")) return "avoid";
  if (a.severity === "Severe" || /warning/i.test(a.event ?? "")) return "serious";
  if (a.severity === "Moderate") return "caution";
  return "info";
}

function minutePrecipSummary(forecast: MinutePrecipForecast): string {
  const minutes = forecast.minutes.slice(0, 60);
  const hasAnyPrecip = minutes.some((m) => m.precipIntensityMmh > 0 || m.precipProbability > 0.1);
  const firstWet = minutes.findIndex((m) => m.precipIntensityMmh > 0.1);
  const lastWet = minutes.reduceRight<number>(
    (acc, m, i) => (acc === -1 && m.precipIntensityMmh > 0.1 ? i : acc),
    -1
  );
  if (!hasAnyPrecip) return "Dry for the next hour";
  if (firstWet === 0 && lastWet >= 55) return "Rain expected throughout the hour";
  if (firstWet === 0) return `Rain easing around ${formatEtaDuration(lastWet + 1)} from now`;
  if (firstWet <= 5) return "Rain starting soon";
  return `Rain likely in about ${formatEtaDuration(firstWet)}`;
}

type Props = {
  areaLabel: string;
  nowcast?: CurrentNowcast | null;
  minutePrecip?: MinutePrecipForecast | null;
  hourlyForecast?: PointHourlyForecast | null;
  locationAlerts?: NormalizedWeatherAlert[];
  nwsLoading?: boolean;
  nwsError?: string | null;
  onLocationAlertClick?: (alert: NormalizedWeatherAlert) => void;
};

/**
 * Local weather in the expanded advisory bar — NWS, right now, next hour, and 24-hour outlook.
 */
export function AdvisoryLocalForecast({
  areaLabel,
  nowcast,
  minutePrecip,
  hourlyForecast,
  locationAlerts = [],
  nwsLoading = false,
  nwsError = null,
  onLocationAlertClick,
}: Props) {
  const nowLine = nowcast
    ? formatNowcastLine(nowcast)
    : minutePrecip?.now
      ? formatMinutePrecipNowLine(minutePrecip.now)
      : null;
  const hasNow = Boolean(nowLine);
  const hasHour = Boolean(minutePrecip?.minutes.length);
  const hours = hourlyForecast?.hours ?? [];
  const hasDay = hours.length > 0;
  const hasNws = locationAlerts.length > 0;
  const showNwsBlock = hasNws || nwsLoading || Boolean(nwsError?.trim());
  const metaUpdated = useMemo(() => {
    const ms = latestForecastFetchedAtMs(
      nowcast?.fetchedAtMs,
      minutePrecip?.fetchedAt,
      hourlyForecast?.fetchedAt
    );
    return ms != null ? formatForecastUpdatedAt(ms) : null;
  }, [nowcast?.fetchedAtMs, minutePrecip?.fetchedAt, hourlyForecast?.fetchedAt]);

  if (!hasNow && !hasHour && !hasDay && !showNwsBlock) return null;

  const hourSummary = minutePrecip ? minutePrecipSummary(minutePrecip) : null;
  const daySummary = hasDay ? pointHourlyForecastSummary(hours) : null;
  const hourlyProviderLabel =
    hourlyForecast?.provider === "openWeather" ? "OpenWeather · 3 h steps" : "Tomorrow.io";

  return (
    <section className="adv-forecast" aria-label={`Local forecast for ${areaLabel}`}>
      <header className="adv-forecast__head">
        <div className="adv-forecast__head-text">
          <h3 className="adv-forecast__title">Local forecast</h3>
          <p className="adv-forecast__area">
            <svg
              className="adv-forecast__area-pin"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden
            >
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z" />
            </svg>
            <span>{areaLabel}</span>
          </p>
        </div>
        {metaUpdated ? <span className="adv-forecast__updated">{metaUpdated}</span> : null}
      </header>

      {showNwsBlock ? (
        <div className="adv-forecast__block adv-forecast__block--nws">
          <div className="adv-forecast__block-head">
            <span className="adv-forecast__block-label">
              {hasNws
                ? locationAlerts.length === 1
                  ? "Active NWS alert"
                  : `Active NWS alerts (${locationAlerts.length})`
                : "NWS alerts"}
            </span>
            <span className="adv-forecast__block-meta">Near you · NWS</span>
          </div>
          {nwsLoading && !hasNws ? (
            <p className="adv-forecast__nws-status">Loading active alerts from api.weather.gov…</p>
          ) : null}
          {nwsError?.trim() && !hasNws && !nwsLoading ? (
            <p className="adv-forecast__nws-status adv-forecast__nws-status--warn">
              Could not refresh NWS alerts. Conditions below may still be current.
            </p>
          ) : null}
          {hasNws ? (
            <ul className="adv-forecast__nws-list" role="list">
              {locationAlerts.map((a) => {
                const summary = nwsGlanceSummary(a);
                const label = a.event?.trim() || "Weather alert";
                const body = summary ? `${label} — ${summary}` : label;
                const sev = nwsRowSeverityClass(a);
                return (
                  <li key={a.id}>
                    {onLocationAlertClick ? (
                      <button
                        type="button"
                        className={`adv-forecast__nws-row adv-forecast__nws-row--${sev}`}
                        onClick={() => onLocationAlertClick(a)}
                      >
                        {body}
                      </button>
                    ) : (
                      <p className={`adv-forecast__nws-row adv-forecast__nws-row--static adv-forecast__nws-row--${sev}`}>
                        {body}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : !nwsLoading && !nwsError?.trim() ? (
            <p className="adv-forecast__nws-status">No active NWS alerts near you right now.</p>
          ) : null}
        </div>
      ) : null}

      {hasNow && nowLine ? (
        <div className="adv-forecast__block">
          <div className="adv-forecast__block-head">
            <span className="adv-forecast__block-label">Right now</span>
            <span className="adv-forecast__block-meta">
              {formatForecastUpdatedAt(
                nowcast?.fetchedAtMs ?? minutePrecip?.fetchedAt ?? Date.now()
              )}
              {nowcast ? " · OpenWeather" : " · Tomorrow.io"}
            </span>
          </div>
          <p className="adv-forecast__conditions">{nowLine}</p>
        </div>
      ) : null}

      {hasHour && minutePrecip ? (
        <div className="adv-forecast__block adv-forecast__block--hour">
          <div className="adv-forecast__block-head">
            <span className="adv-forecast__block-label">Next hour</span>
            <span className="adv-forecast__block-meta">
              {formatForecastUpdatedAt(minutePrecip.fetchedAt)} · Tomorrow.io
            </span>
          </div>
          <p className="adv-forecast__hour-summary">{hourSummary}</p>
          <div
            className="adv-forecast__bar"
            aria-label="Minute-by-minute precipitation for the next 60 minutes at your location"
          >
            {minutePrecip.minutes.slice(0, 60).map((m, i) => (
              <div
                key={i}
                className="adv-forecast__cell"
                style={{
                  background: precipColor(m.precipIntensityMmh, m.precipProbability),
                }}
                title={`+${formatEtaDuration(i + 1)}: ${m.precipIntensityMmh.toFixed(1)} mm/hr`}
              />
            ))}
          </div>
          <div className="adv-forecast__axis">
            <span>Now</span>
            <span>{formatEtaDuration(30)}</span>
            <span>{formatEtaDuration(60)}</span>
          </div>
        </div>
      ) : null}

      {hasDay ? (
        <div className="adv-forecast__block adv-forecast__block--day">
          <div className="adv-forecast__block-head">
            <span className="adv-forecast__block-label">Next 24 hours</span>
            <span className="adv-forecast__block-meta">
              {hourlyForecast
                ? `${formatForecastUpdatedAt(hourlyForecast.fetchedAt)} · ${hourlyProviderLabel}`
                : null}
            </span>
          </div>
          {daySummary ? <p className="adv-forecast__hour-summary">{daySummary}</p> : null}
          <div
            className="adv-forecast__hour24-scroll"
            role="img"
            aria-label={`Hourly forecast for the next 24 hours at ${areaLabel}`}
          >
            <div className="adv-forecast__hour24-cols">
              {hours.map((h, i) => (
                <div
                  key={h.timeIso}
                  className="adv-forecast__hour24-col"
                  title={`${formatLocalForecastHourLabel(h.offsetHours, i)}: ${h.tempF}°F, ${h.conditions}${
                    h.precipProbability > 0.1
                      ? `, ${Math.round(h.precipProbability * 100)}% precip`
                      : ""
                  }`}
                >
                  <span className="adv-forecast__hour24-time">
                    {formatLocalForecastHourLabel(h.offsetHours, i)}
                  </span>
                  <span className="adv-forecast__hour24-temp">{h.tempF}°</span>
                  <div
                    className="adv-forecast__hour24-precip"
                    style={{
                      background: precipColor(h.precipIntensityMmh, h.precipProbability),
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
          <div className="adv-forecast__axis adv-forecast__axis--day">
            <span>Now</span>
            <span>6 hr</span>
            <span>12 hr</span>
            <span>18 hr</span>
            <span>24 hr</span>
          </div>
        </div>
      ) : null}
    </section>
  );
}
