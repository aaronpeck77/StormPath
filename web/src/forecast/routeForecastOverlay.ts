import type { RouteForecast } from "../services/tomorrowIo";
import { routeForecastCorridorStress } from "../services/tomorrowIo";
import type { WeatherOverlay } from "../situation/fusedSnapshot";
import { tomorrowForecastToWxSamples } from "../nav/routeForecastTimeline";
import { corridorForecastHeadline } from "./corridorForecastModel";

/**
 * Derives fused-snapshot corridor weather from WeatherKit / Tomorrow.io route forecast
 * (replaces the retired OpenWeather corridor overlay).
 */
export function buildRouteWeatherOverlayFromForecast(
  forecast: RouteForecast | null | undefined,
  legId: string,
  planEtaMinutes: number | null | undefined
): WeatherOverlay | undefined {
  if (!forecast?.intervals.length || !legId.trim()) return undefined;
  const headline = corridorForecastHeadline(forecast);
  const precipHint = Math.min(1, Math.max(0, routeForecastCorridorStress(forecast)));
  const samples =
    planEtaMinutes != null && planEtaMinutes > 0
      ? tomorrowForecastToWxSamples(forecast, planEtaMinutes)
      : undefined;
  return {
    [legId]: {
      headline,
      precipHint,
      samples: samples?.length ? samples : undefined,
    },
  };
}
