import { formatEtaDuration } from "./formatEta";

export type TrafficBypassComparePanelProps = {
  headline: string;
  etaA: number;
  etaB: number | null;
  etaC: number | null;
  hasB: boolean;
  hasC: boolean;
  onPick: (routeId: "r-a" | "r-b" | "r-c") => void;
  onCancel: () => void;
};

/** Short delta for the one-line summary, e.g. "−7m" vs A */
function savingsShortVsA(etaA: number, etaAlt: number | null): string | null {
  if (etaAlt == null) return null;
  const d = Math.round(etaA - etaAlt);
  if (d >= 1) return `−${d}m vs A`;
  if (d <= -1) return `+${-d}m vs A`;
  return "same vs A";
}

export function TrafficBypassComparePanel(props: TrafficBypassComparePanelProps) {
  const { headline, etaA, etaB, etaC, hasB, hasC, onPick, onCancel } = props;
  const shortB = hasB && etaB != null ? savingsShortVsA(etaA, etaB) : null;
  const shortC = hasC && etaC != null ? savingsShortVsA(etaA, etaC) : null;

  return (
    <div
      className="traffic-bypass-compare"
      role="dialog"
      aria-modal="true"
      aria-label="Traffic bypass options"
    >
      <div className="traffic-bypass-compare__header">
        <span className="traffic-bypass-compare__title">Traffic bypass</span>
        <span className="traffic-bypass-compare__sub">{headline}</span>
      </div>
      <p className="traffic-bypass-compare__hint">
        Flags on the map show each option’s ETA and time saved vs staying on A. Tap a flag or use the buttons — your pick
        becomes the primary route for guidance.
      </p>
      <p className="traffic-bypass-compare__compact-line">
        <span className="traffic-bypass-compare__compact-item traffic-bypass-compare__compact-item--a">
          A {formatEtaDuration(etaA)}
        </span>
        {hasB && etaB != null && (
          <span className="traffic-bypass-compare__compact-item traffic-bypass-compare__compact-item--b">
            · B {formatEtaDuration(etaB)}
            {shortB ? ` (${shortB})` : ""}
          </span>
        )}
        {hasC && etaC != null && (
          <span className="traffic-bypass-compare__compact-item traffic-bypass-compare__compact-item--c">
            · C {formatEtaDuration(etaC)}
            {shortC ? ` (${shortC})` : ""}
          </span>
        )}
      </p>
      <div className="traffic-bypass-compare__actions">
        <button type="button" className="traffic-bypass-compare__btn traffic-bypass-compare__btn--ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="traffic-bypass-compare__btn traffic-bypass-compare__btn--a" onClick={() => onPick("r-a")}>
          Use A
        </button>
        <button
          type="button"
          className="traffic-bypass-compare__btn traffic-bypass-compare__btn--b"
          disabled={!hasB}
          onClick={() => onPick("r-b")}
        >
          Use B
        </button>
        <button
          type="button"
          className="traffic-bypass-compare__btn traffic-bypass-compare__btn--c"
          disabled={!hasC}
          onClick={() => onPick("r-c")}
        >
          Use C
        </button>
      </div>
    </div>
  );
}
