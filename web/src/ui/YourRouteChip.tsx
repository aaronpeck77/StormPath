import type { PersonalForkOffer } from "../personalForks";
import { formatForkEtaDelta } from "../personalForks";

type Props = {
  offer: PersonalForkOffer;
  committed: boolean;
  onTake: () => void;
  onDismiss: () => void;
};

/** Drive-view chip: habitual fork approaching or already committed. */
export function YourRouteChip({ offer, committed, onTake, onDismiss }: Props) {
  const eta = formatForkEtaDelta(offer.fork.typicalEtaDeltaMin);
  const miles = (offer.metersToFork / 1609.34).toFixed(offer.metersToFork < 1609 ? 1 : 0);
  const subtitle = committed
    ? "Following your usual path"
    : offer.phase === "on_fork"
      ? "Looks like your usual path"
      : eta
        ? `In ${miles} mi · ${eta}`
        : `In ${miles} mi`;

  return (
    <div
      className={`your-route-chip${committed ? " your-route-chip--committed" : ""}`}
      role="status"
      aria-live="polite"
    >
      <div className="your-route-chip__text">
        <span className="your-route-chip__title">Your route</span>
        <span className="your-route-chip__sub">{subtitle}</span>
      </div>
      {!committed ? (
        <div className="your-route-chip__actions">
          <button type="button" className="your-route-chip__btn your-route-chip__btn--primary" onClick={onTake}>
            Take
          </button>
          <button type="button" className="your-route-chip__btn" onClick={onDismiss} aria-label="Not today">
            Not today
          </button>
        </div>
      ) : null}
    </div>
  );
}
