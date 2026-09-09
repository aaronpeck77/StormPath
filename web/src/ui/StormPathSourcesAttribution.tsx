import { getWebEnv } from "../config/env";
import { AppleWeatherAttribution } from "./AppleWeatherAttribution";

type SourceLink = {
  id: string;
  label: string;
  href: string;
};

function buildSourceLinks(): SourceLink[] {
  const env = getWebEnv();
  const links: SourceLink[] = [
    { id: "mapbox", label: "Mapbox", href: "https://www.mapbox.com/about/maps/" },
    { id: "osm", label: "OSM", href: "https://www.openstreetmap.org/copyright" },
    { id: "rainviewer", label: "RainViewer", href: "https://www.rainviewer.com/" },
    { id: "nws", label: "NWS", href: "https://www.weather.gov/" },
  ];
  if (env.tomorrowIoApiKey) {
    links.push({ id: "tomorrow", label: "Tomorrow.io", href: "https://www.tomorrow.io/" });
  }
  if (env.openWeatherApiKey) {
    links.push({
      id: "openweather",
      label: "OpenWeather",
      href: "https://openweathermap.org/",
    });
  }
  return links;
}

type Props = {
  theme?: "light" | "dark";
  className?: string;
  /** Show required  Weather mark + legal link (WeatherKit builds). */
  includeAppleWeather?: boolean;
  /** Shorter “Also:” row for tight panels. */
  compact?: boolean;
};

/**
 * Provider name row so Mapbox / radar / NWS / forecast vendors stay credited
 * next to WeatherKit (App Review + ToS belt-and-suspenders).
 */
export function StormPathSourcesAttribution({
  theme = "dark",
  className,
  includeAppleWeather = false,
  compact = false,
}: Props) {
  const links = buildSourceLinks();
  return (
    <div
      className={`sp-sources-attr${compact ? " sp-sources-attr--compact" : ""}${
        className ? ` ${className}` : ""
      }`}
      role="contentinfo"
      aria-label="Data sources"
    >
      {includeAppleWeather ? (
        <AppleWeatherAttribution theme={theme} compact={compact} />
      ) : null}
      <p className="sp-sources-attr__also">
        <span className="sp-sources-attr__also-label">{compact ? "Also" : "Also using"}</span>
        {links.map((s, i) => (
          <span key={s.id} className="sp-sources-attr__chip">
            {i > 0 ? <span className="sp-sources-attr__sep" aria-hidden>
              ·
            </span> : null}
            <a href={s.href} target="_blank" rel="noreferrer">
              {s.label}
            </a>
          </span>
        ))}
      </p>
    </div>
  );
}
