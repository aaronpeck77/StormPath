import { useState, type ReactNode } from "react";

type Props = {
  /** localStorage key suffix — collapse state persists per section. */
  id: string;
  /** Screen-reader label for the collapse tab. */
  label: string;
  children: ReactNode;
};

const storageKey = (id: string) => `sp-panel-collapse-${id}`;

function readOpen(id: string): boolean {
  try {
    return localStorage.getItem(storageKey(id)) !== "0";
  } catch {
    return true;
  }
}

/**
 * iPad landscape command-panel section that collapses to a tab on the panel's
 * outer edge so the map can use the freed space. TBT slot and bottom dock are
 * never wrapped — they stay put.
 */
export function CollapsiblePanelSection({ id, label, children }: Props) {
  const [open, setOpen] = useState(() => readOpen(id));

  const toggle = () => {
    setOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(storageKey(id), next ? "1" : "0");
      } catch {
        /* private mode — state still toggles for the session */
      }
      return next;
    });
  };

  return (
    <div className={`panel-collapse${open ? "" : " panel-collapse--closed"}`}>
      {open ? children : null}
      <button
        type="button"
        className="panel-collapse__tab"
        aria-label={open ? `Collapse ${label}` : `Expand ${label}`}
        aria-expanded={open}
        title={open ? `Collapse ${label}` : `Expand ${label}`}
        onClick={toggle}
      >
        <span className="panel-collapse__chev" aria-hidden>
          {open ? "‹" : "›"}
        </span>
      </button>
    </div>
  );
}
