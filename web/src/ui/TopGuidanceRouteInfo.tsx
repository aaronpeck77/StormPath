import type { CSSProperties } from "react";
import type { ScoredRoute } from "../scoring/scoreRoutes";
import {
  etaArrivalTimestamp,
  formatDelayVersusBaseline,
  formatEtaClock,
  formatEtaDuration,
} from "./formatEta";
import { routeHex } from "./mapRouteStyle";

type Props = {
  routes: ScoredRoute[];
  highlightRouteId: string;
  mapboxForTraffic: boolean;
  trafficFetchDone: boolean;
  /** Added on right rail for stacked layout */
  className?: string;
};

export function trafficHintForScoredRoute(
  s: ScoredRoute,
  mapbox: boolean,
  fetchDone: boolean
): { text: string; live: boolean } {
  if (s.hasLiveTrafficEstimate) {
    if (s.trafficDelayMinutes >= 10) {
      const d = formatDelayVersusBaseline(s.trafficDelayMinutes);
      return { text: d ? `${d} traffic` : "clear", live: true };
    }
    return { text: "clear", live: true };
  }
  if (!mapbox) return { text: "no traffic API", live: false };
  if (!fetchDone) return { text: "traffic…", live: false };
  return { text: "no traffic read", live: false };
}

/** Read-only ETA + traffic per route (top strip or right-rail stack). */
export function TopGuidanceRouteInfo({
  routes,
  highlightRouteId,
  mapboxForTraffic,
  trafficFetchDone,
  className,
}: Props) {
  if (routes.length === 0) return null;

  return (
    <div
      className={`top-guidance-bar__route-info${className ? ` ${className}` : ""}`}
      aria-label="Route times and traffic"
    >
      <div className="top-guidance-route-info-scroll">
        {routes.map((s) => {
          const active = s.route.id === highlightRouteId;
          const hex = routeHex(s.route);
          const t = trafficHintForScoredRoute(s, mapboxForTraffic, trafficFetchDone);
          return (
            <span
              key={s.route.id}
              className={`top-guidance-route-info-seg${active ? " top-guidance-route-info-seg--active" : ""}${
                s.notable ? " top-guidance-route-info-seg--notable" : ""
              }`}
              style={{ "--route-line": hex } as CSSProperties & { "--route-line": string }}
            >
              <span className="top-guidance-route-info-line">
                <span className="top-guidance-route-info-name">{s.route.label}</span>
                <span className="top-guidance-route-info-meta">
                  {formatEtaDuration(s.effectiveEtaMinutes)} ·{" "}
                  {formatEtaClock(etaArrivalTimestamp(s.effectiveEtaMinutes))} ·{" "}
                  <span
                    className={
                      t.live ? "top-guidance-route-info-traffic--live" : "top-guidance-route-info-traffic"
                    }
                  >
                    {t.text}
                  </span>
                </span>
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
