import { useEffect } from "react";
import type { RouteAlert } from "../nav/routeAlerts";

type Props = {
  open: boolean;
  /** Route leg this tap was on (may differ from active leg while comparing). */
  routeId: string;
  focusedRouteId: string;
  alerts: RouteAlert[];
  alternateRouteAvailable: boolean;
  /** True when a fetch-alternates-and-compare flow is available (traffic stop / delay). */
  bypassCompareAvailable?: boolean;
  bypassBusy?: boolean;
  onClose: () => void;
  onTryAlternateRoute: () => void;
  /** Compute three live reroute options (stay / surgical bypass / alternate) and show compare panel. */
  onCompareReroutes?: () => void;
  onOpenRouteView: () => void;
  /** Fit map to this hazard / corridor context */
  onShowOnMap: (alert: RouteAlert) => void;
  /** Switch active / navigated leg to the tapped polyline */
  onSelectThisRoute: (routeId: string) => void;
};

export function RouteHazardSheet({
  open,
  routeId,
  focusedRouteId,
  alerts,
  alternateRouteAvailable,
  bypassCompareAvailable = false,
  bypassBusy = false,
  onClose,
  onTryAlternateRoute,
  onCompareReroutes,
  onOpenRouteView,
  onShowOnMap,
  onSelectThisRoute,
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
  const showSwitch = routeId !== focusedRouteId;
  const primaryIsTraffic =
    primary != null &&
    (primary.id === "traffic" || primary.id === "traffic-delay" || /traffic|stopped|closure|jam/i.test(primary.title ?? ""));

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
            Open Hazards or Route view for the full list along your trip.
          </p>
        )}
        <div className="route-hazard-sheet__actions">
          {primary && (
            <button type="button" className="route-hazard-sheet__btn route-hazard-sheet__btn--primary" onClick={() => onShowOnMap(primary)}>
              Show on map
            </button>
          )}
          {primaryIsTraffic && bypassCompareAvailable && onCompareReroutes ? (
            <button
              type="button"
              className="route-hazard-sheet__btn route-hazard-sheet__btn--primary"
              onClick={onCompareReroutes}
              disabled={bypassBusy}
              title="See 3 reroute options on the map"
            >
              {bypassBusy ? "Finding options…" : "See 3 reroute options"}
            </button>
          ) : (
            alternateRouteAvailable && (
              <button type="button" className="route-hazard-sheet__btn" onClick={onTryAlternateRoute}>
                Try alternate route
              </button>
            )
          )}
          <button type="button" className="route-hazard-sheet__btn" onClick={onOpenRouteView}>
            Route view
          </button>
          {showSwitch && (
            <button type="button" className="route-hazard-sheet__btn" onClick={() => onSelectThisRoute(routeId)}>
              Use this route leg
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
