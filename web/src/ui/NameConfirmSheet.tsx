import { useEffect, useState } from "react";

type Props = {
  title: string;
  initialName: string;
  confirmLabel?: string;
  hint?: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
};

/** Bottom sheet: single-line name — used for save route / recorded path / frequent route flows. */
export function NameConfirmSheet({
  title,
  initialName,
  confirmLabel = "Save",
  hint,
  onConfirm,
  onCancel,
}: Props) {
  const [name, setName] = useState(initialName);

  useEffect(() => {
    setName(initialName);
  }, [initialName]);

  return (
    <>
      <div className="name-sheet-scrim" role="presentation" onClick={onCancel} />
      <div className="name-sheet" role="dialog" aria-labelledby="name-sheet-title">
        <h2 id="name-sheet-title" className="name-sheet-title">
          {title}
        </h2>
        {hint ? <p className="name-sheet-hint">{hint}</p> : null}
        <input
          className="name-sheet-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          enterKeyHint="done"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onConfirm(name.trim() || initialName.trim() || "Saved");
            }
            if (e.key === "Escape") onCancel();
          }}
          aria-label="Name"
        />
        <div className="name-sheet-actions">
          <button type="button" className="name-sheet-btn name-sheet-btn--ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="name-sheet-btn name-sheet-btn--primary"
            onClick={() => onConfirm(name.trim() || initialName.trim() || "Saved")}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </>
  );
}
