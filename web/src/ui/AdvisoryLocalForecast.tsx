import { useMemo } from "react";
import type { CurrentNowcast } from "../services/openWeatherClient";
import { formatNowcastLine } from "../services/openWeatherClient";
import type { MinutePrecipForecast } from "../services/tomorrowIo";
import { formatForecastUpdatedAt, latestForecastFetchedAtMs } from "../utils/forecastDisplay";

function precipColor(mmh: number, prob: number): string {
  const effective = mmh * Math.max(0.3, prob);
  if (effective === 0) return "rgba(148, 163, 184, 0.12)";
  if (effective < 0.1) return "#93c5fd";
  if (effective < 0.5) return "#60a5fa";
  if (effective < 2.5) return "#3b82f6";
  if (effective < 7.5) return "#7c3aed";
  return "#ef4444";
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
  if (firstWet === 0) return `Rain easing around ${lastWet + 1} minutes from now`;
  if (firstWet <= 5) return "Rain starting soon";
  return `Rain likely in about ${firstWet} minutes`;
}

type Props = {
  areaLabel: string;
  nowcast?: CurrentNowcast | null;
  minutePrecip?: MinutePrecipForecast | null;
};

/** Local weather in the expanded advisory bar — area, update time, now + next hour. */
export function AdvisoryLocalForecast({ areaLabel, nowcast, minutePrecip }: Props) {
  const hasNow = Boolean(nowcast);
  const hasHour = Boolean(minutePrecip?.minutes.length);
  if (!hasNow && !hasHour) return null;

  const nowLine = nowcast ? formatNowcastLine(nowcast) : null;
  const hourSummary = minutePrecip ? minutePrecipSummary(minutePrecip) : null;
  const metaUpdated = useMemo(() => {
    const ms = latestForecastFetchedAtMs(nowcast?.fetchedAtMs, minutePrecip?.fetchedAt);
    return ms != null ? formatForecastUpdatedAt(ms) : null;
  }, [nowcast?.fetchedAtMs, minutePrecip?.fetchedAt]);

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

      {hasNow && nowcast && nowLine ? (
        <div className="adv-forecast__block">
          <div className="adv-forecast__block-head">
            <span className="adv-forecast__block-label">Right now</span>
            <span className="adv-forecast__block-meta">
              {formatForecastUpdatedAt(nowcast.fetchedAtMs)} · OpenWeather
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
                title={`+${i + 1} min: ${m.precipIntensityMmh.toFixed(1)} mm/hr`}
              />
            ))}
          </div>
          <div className="adv-forecast__axis">
            <span>Now</span>
            <span>30 min</span>
            <span>60 min</span>
          </div>
        </div>
      ) : null}
    </section>
  );
}
