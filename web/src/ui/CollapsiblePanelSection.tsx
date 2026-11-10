import { useState, type ReactNode } from "react";

type Props = {
  /** localStorage key suffix — collapse state persists per section. */
  id: string;
  /** Screen-reader label for the collapse tab. */
  label: string;
  /** Extra class on the wrapper (e.g. pin-to-bottom in the iPad panel). */
  className?: string;
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
 * outer edge so the map can use the freed space. The bottom dock/chrome are
 * never wrapped — they stay pinned and can't collapse.
 */
export function CollapsiblePanelSection({ id, label, className, children }: Props) {
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
    <div className={`panel-collapse${open ? "" : " panel-collapse--closed"}${className ? ` ${className}` : ""}`}>
      {/* Children stay mounted — the TBT slot is a portal target and must exist
       * even while collapsed. Hiding is CSS-only inside the tablet-landscape MQ,
       * so a persisted "closed" state can never hide content on phones (where the
       * tab itself is hidden). */}
      <div className="panel-collapse__body">{children}</div>
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
