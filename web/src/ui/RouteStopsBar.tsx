import type { TripStop } from "../nav/routeWaypoints";

type Props = {
  viaStops: TripStop[];
  addingStop: boolean;
  canAddStop: boolean;
  onStartAddStop: () => void;
  onCancelAddStop: () => void;
  onRemoveStop: (index: number) => void;
};

/** Optional single stop before the final destination. */
export function RouteStopsBar({
  viaStops,
  addingStop,
  canAddStop,
  onStartAddStop,
  onCancelAddStop,
  onRemoveStop,
}: Props) {
  if (!canAddStop && viaStops.length === 0) return null;

  const stop = viaStops[0];

  return (
    <div className="route-stops-bar" role="group" aria-label="Optional stop">
      {stop ? (
        <ul className="route-stops-bar__list">
          <li className="route-stops-bar__item">
            <span className="route-stops-bar__badge" aria-hidden>
              Stop
            </span>
            <span className="route-stops-bar__label" title={stop.label}>
              {stop.label}
            </span>
            <button
              type="button"
              className="route-stops-bar__remove"
              aria-label={`Remove stop: ${stop.label}`}
              onClick={() => onRemoveStop(0)}
            >
              ×
            </button>
          </li>
        </ul>
      ) : null}
      {canAddStop && !stop ? (
        <div className="route-stops-bar__actions">
          {addingStop ? (
            <>
              <span className="route-stops-bar__hint">Tap the map or search for your stop</span>
              <button type="button" className="route-stops-bar__cancel" onClick={onCancelAddStop}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" className="route-stops-bar__add" onClick={onStartAddStop}>
              + Add a stop
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
