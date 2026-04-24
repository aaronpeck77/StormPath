import { useState } from "react";
import type { FusedSituationSnapshot } from "../situation/types";
import type { ScoredRoute } from "../scoring/scoreRoutes";
import { formatDelayVersusBaseline, formatEtaDuration } from "./formatEta";

type Props = {
  snap: FusedSituationSnapshot;
  scored: ScoredRoute[];
  activeRouteId: string;
};

export function FusePanel({ snap, scored, activeRouteId }: Props) {
  const [open, setOpen] = useState(false);
  const active = scored.find((s) => s.route.id === activeRouteId);
  const slice = snap.routes.find((r) => r.routeId === activeRouteId);

  return (
    <div className="fuse-panel fuse-panel-compact">
      <button
        type="button"
        className="fuse-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? "Hide route details" : "Route details (traffic · weather · notes)"}
      </button>
      {open && active && slice && (
        <>
          <p className="fuse-summary">{active.fuseSummary}</p>
          <ul className="fuse-details">
            <li>
              {slice.hasLiveTrafficEstimate && slice.mapboxDurationMinutes != null
                ? `Drive ~${formatEtaDuration(slice.mapboxDurationMinutes)} (Mapbox traffic)${
                    slice.trafficDelayMinutes > 0.5
                      ? `, ${formatDelayVersusBaseline(slice.trafficDelayMinutes)} vs static`
                      : ""
                  }`
                : `Traffic: static ETA only (~${formatEtaDuration(active.route.baseEtaMinutes)}) — add Mapbox for live`}
            </li>
            <li>Weather weight on map: {Math.round(slice.radarIntensity * 100)}%</li>
            <li className="fuse-forecast">{slice.forecastHeadline}</li>
            {slice.hazards.map((h, i) => (
              <li key={i}>
                {h.kind}: {h.summary}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
