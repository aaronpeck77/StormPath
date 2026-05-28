import { useEffect } from "react";

type Props = {
  open: boolean;
  tollLabels: string[];
  /** Shown when “Avoid tolls” could not produce a toll-free path. */
  avoidFailureNote?: string | null;
  busy?: boolean;
  onContinue: () => void;
  onPreview: () => void;
};

export function TollRouteSheet({
  open,
  tollLabels,
  avoidFailureNote = null,
  busy = false,
  onContinue,
  onPreview,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onContinue();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onContinue]);

  if (!open) return null;

  return (
    <div className="route-hazard-sheet-backdrop" role="presentation" onClick={onContinue}>
      <div
        className="route-hazard-sheet route-hazard-sheet--toll"
        role="dialog"
        aria-labelledby="toll-route-sheet-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="toll-route-sheet-title" className="route-hazard-sheet__title">
          Tolls on this route
        </h2>
        <p className="route-hazard-sheet__headline">
          This path uses toll roads or toll collection points.
        </p>
        {tollLabels.length > 0 ? (
          <ul className="route-hazard-sheet__also" aria-label="Toll segments">
            {tollLabels.map((label) => (
              <li key={label}>
                <span className="route-hazard-sheet__also-tag">Toll</span>
                <span className="route-hazard-sheet__also-text">{label}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="route-hazard-sheet__detail">
            This route uses toll roads or collection points. Preview a toll-free alternative on the
            map before switching, or continue if tolls are OK.
          </p>
        )}
        {avoidFailureNote ? (
          <p className="route-hazard-sheet__detail route-hazard-sheet__detail--toll-warn" role="status">
            {avoidFailureNote}
          </p>
        ) : null}
        <div className="route-hazard-sheet__actions">
          <button
            type="button"
            className="route-hazard-sheet__btn route-hazard-sheet__btn--primary"
            onClick={onPreview}
            disabled={busy}
          >
            {busy ? "Loading toll-free preview…" : "Preview toll-free route"}
          </button>
          <button
            type="button"
            className="route-hazard-sheet__btn route-hazard-sheet__btn--ghost"
            onClick={onContinue}
            disabled={busy}
          >
            Continue with tolls
          </button>
        </div>
      </div>
    </div>
  );
}
