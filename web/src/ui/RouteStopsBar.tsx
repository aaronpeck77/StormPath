import { MAX_VIA_STOPS, type TripStop } from "../nav/routeWaypoints";

type Props = {
  viaStops: TripStop[];
  addingStop: boolean;
  canAddStop: boolean;
  onStartAddStop: () => void;
  onCancelAddStop: () => void;
  onRemoveStop: (index: number) => void;
};

/** Optional intermediate stops before the final destination. */
export function RouteStopsBar({
  viaStops,
  addingStop,
  canAddStop,
  onStartAddStop,
  onCancelAddStop,
  onRemoveStop,
}: Props) {
  const canAdd = canAddStop && viaStops.length < MAX_VIA_STOPS;
  if (!canAdd && viaStops.length === 0) return null;

  return (
    <div className="route-stops-bar" role="group" aria-label="Optional stops">
      {viaStops.length > 0 ? (
        <ul className="route-stops-bar__list">
          {viaStops.map((stop, i) => (
            <li className="route-stops-bar__item" key={`${i}-${stop.label}`}>
              <span className="route-stops-bar__badge" aria-hidden>
                Stop {i + 1}
              </span>
              <span className="route-stops-bar__label" title={stop.label}>
                {stop.label}
              </span>
              <button
                type="button"
                className="route-stops-bar__remove"
                aria-label={`Remove stop: ${stop.label}`}
                onClick={() => onRemoveStop(i)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {canAdd ? (
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
