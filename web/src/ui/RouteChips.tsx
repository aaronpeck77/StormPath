import type { ScoredRoute } from "../scoring/scoreRoutes";
import { formatEtaDuration } from "./formatEta";

type Props = {
  scored: ScoredRoute[];
  activeRouteId: string;
  onSelect: (routeId: string) => void;
};

export function RouteChips({ scored, activeRouteId, onSelect }: Props) {
  return (
    <div className="route-chips" role="tablist" aria-label="Route options">
      {scored.map((s) => {
        const active = s.route.id === activeRouteId;
        return (
          <button
            key={s.route.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={`route-chip ${active ? "active" : ""} ${s.notable ? "notable" : ""}`}
            onClick={() => onSelect(s.route.id)}
          >
            <span className="route-chip-label">{s.route.label}</span>
            <span className="route-chip-eta">{formatEtaDuration(s.effectiveEtaMinutes)}</span>
          </button>
        );
      })}
    </div>
  );
}
