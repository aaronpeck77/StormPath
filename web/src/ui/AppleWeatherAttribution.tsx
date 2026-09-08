import { useEffect, useState } from "react";
import {
  fetchWeatherKitAttribution,
  weatherKitMarkUrlForTheme,
  type WeatherKitAttribution,
  WEATHERKIT_ATTRIBUTION_FALLBACK,
} from "../services/weatherKitAttribution";

type Props = {
  /** Dark UI (advisory / night map) uses the light mark asset. */
  theme?: "light" | "dark";
  className?: string;
};

/**
 * Required WeatherKit attribution: Apple Weather trademark + legal source link (5.2.5).
 */
export function AppleWeatherAttribution({ theme = "dark", className }: Props) {
  const [attr, setAttr] = useState<WeatherKitAttribution>(WEATHERKIT_ATTRIBUTION_FALLBACK);

  useEffect(() => {
    let cancelled = false;
    void fetchWeatherKitAttribution("en-US").then((next) => {
      if (!cancelled) setAttr(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const markUrl = weatherKitMarkUrlForTheme(attr, theme);
  const legalHref = attr.legalPageURL || WEATHERKIT_ATTRIBUTION_FALLBACK.legalPageURL;

  return (
    <div
      className={`apple-weather-attr${className ? ` ${className}` : ""}`}
      role="contentinfo"
      aria-label="Apple Weather attribution"
    >
      {markUrl ? (
        <a
          className="apple-weather-attr__mark-link"
          href={legalHref}
          target="_blank"
          rel="noreferrer"
          title="Apple Weather legal attribution"
        >
          <img
            className="apple-weather-attr__mark"
            src={markUrl}
            alt=" Weather"
            height={18}
            decoding="async"
          />
        </a>
      ) : (
        <a
          className="apple-weather-attr__text-mark"
          href={legalHref}
          target="_blank"
          rel="noreferrer"
        >
           Weather
        </a>
      )}
      <a className="apple-weather-attr__legal" href={legalHref} target="_blank" rel="noreferrer">
        Other data sources
      </a>
    </div>
  );
}
