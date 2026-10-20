import type { JamHopOffer } from "../nav/jamDrive";

type Props = {
  offer: JamHopOffer;
  busy: boolean;
  onTake: () => void;
  onDismiss: () => void;
};

/** One line during a drive. A tap measures again to the same destination. */
export function JamHopBanner({ offer, busy, onTake, onDismiss }: Props) {
  return (
    <div className="drive-hazard-approach drive-hazard-approach--strip drive-hazard-approach--early drive-hazard-approach--actionable" role="status">
      <div className="drive-hazard-approach__copy">
        <p className="drive-hazard-approach__title drive-hazard-approach__title--early">{offer.title}</p>
        <p className="drive-hazard-approach__hint">{busy ? "Measuring again from here…" : offer.hint}</p>
      </div>
      <div className="drive-hazard-approach__strip-actions">
        {offer.canTakeNow ? (
          <button type="button" className="drive-hazard-approach__chip" disabled={busy} onClick={onTake}>
            Take it
          </button>
        ) : null}
        <button type="button" className="drive-hazard-approach__chip drive-hazard-approach__chip--icon" aria-label="Dismiss" onClick={onDismiss}>
          ×
        </button>
      </div>
    </div>
  );
}
