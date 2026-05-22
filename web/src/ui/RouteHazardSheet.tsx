import { useEffect } from "react";
import type { RouteAlert } from "../nav/routeAlerts";

type Props = {
  open: boolean;
  alerts: RouteAlert[];
  alternateRouteAvailable: boolean;
  bypassBusy?: boolean;
  onClose: () => void;
  onTryAlternateRoute: () => void;
};

export function RouteHazardSheet({
  open,
  alerts,
  alternateRouteAvailable,
  bypassBusy = false,
  onClose,
  onTryAlternateRoute,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const primary = alerts[0];
  const others = alerts.slice(1);

  return (
    <div className="route-hazard-sheet-backdrop" role="presentation" onClick={onClose}>
      <div
        className="route-hazard-sheet"
        role="dialog"
        aria-labelledby="route-hazard-sheet-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="route-hazard-sheet-title" className="route-hazard-sheet__title">
          Along this part of the route
        </h2>
        {primary ? (
          <>
            <p className="route-hazard-sheet__headline">{primary.title}</p>
            <p className="route-hazard-sheet__detail">{primary.detail}</p>
            {others.length > 0 && (
              <ul className="route-hazard-sheet__also" aria-label="Also near this tap">
                {others.map((a) => (
                  <li key={a.id}>
                    <span className="route-hazard-sheet__also-tag">{a.title}</span>
                    <span className="route-hazard-sheet__also-text">{a.detail}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="route-hazard-sheet__detail route-hazard-sheet__detail--muted">
            No hazard details for this spot.
          </p>
        )}
        <div className="route-hazard-sheet__actions">
          {alternateRouteAvailable && (
            <button
              type="button"
              className="route-hazard-sheet__btn route-hazard-sheet__btn--primary"
              onClick={onTryAlternateRoute}
              disabled={bypassBusy}
            >
              {bypassBusy ? "Finding alternates…" : "Compare routes on map"}
            </button>
          )}
          <button type="button" className="route-hazard-sheet__btn route-hazard-sheet__btn--ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
