import { formatEtaDuration } from "./formatEta";

export type TrafficBypassComparePanelProps = {
  headline: string;
  etaA: number;
  etaB: number | null;
  etaC: number | null;
  hasB: boolean;
  hasC: boolean;
  /** When confidence is `low` the panel softens labels (e.g. "Try local bypass") so we don't imply
   * a guaranteed exit/rejoin against an uncertain jam anchor. */
  confidence?: "low" | "medium" | "high";
  selectedLeg: "r-a" | "r-b" | "r-c" | null;
  onSelect: (routeId: "r-a" | "r-b" | "r-c") => void;
  /** Applies the selected leg as primary and returns to drive view. */
  onConfirm: () => void;
  onCancel: () => void;
};

/** Short delta for the one-line summary, e.g. "−7m" vs A */
function savingsShortVsA(etaA: number, etaAlt: number | null): string | null {
  if (etaAlt == null) return null;
  const d = Math.round(etaA - etaAlt);
  if (d >= 1) return `saves ${d}m`;
  if (d <= -1) return `+${-d}m longer`;
  return "same ETA";
}

type SlotKey = "r-a" | "r-b" | "r-c";

type Option = {
  id: SlotKey;
  badge: "A" | "B" | "C";
  title: string;
  desc: string;
  eta: number | null;
  deltaLabel: string | null;
  disabled: boolean;
};

export function TrafficBypassComparePanel(props: TrafficBypassComparePanelProps) {
  const {
    headline,
    etaA,
    etaB,
    etaC,
    hasB,
    hasC,
    confidence = "medium",
    selectedLeg,
    onSelect,
    onConfirm,
    onCancel,
  } = props;
  const lowConfidence = confidence === "low";

  /* Order matters: A (stay) = always shown; C (local bypass) = surgical detour near the jam;
   * B (alternate route) = full reroute. The user wants to visually compare all three
   * side-by-side without the panel blocking the route flags on the map. */
  const options: Option[] = [
    {
      id: "r-a",
      badge: "A",
      title: "Stay on route",
      desc: lowConfidence
        ? "Hold current plan; ETA from live traffic on this line"
        : "Hold current plan; drive through the slowdown",
      eta: etaA,
      deltaLabel: null,
      disabled: false,
    },
    {
      id: "r-c",
      badge: "C",
      title: lowConfidence ? "Try local bypass" : "Local bypass",
      desc: lowConfidence
        ? "Side-road detour near the corridor — exit/rejoin not guaranteed"
        : "Exit before jam, rejoin after it clears",
      eta: etaC,
      deltaLabel: hasC ? savingsShortVsA(etaA, etaC) : null,
      disabled: !hasC,
    },
    {
      id: "r-b",
      badge: "B",
      title: "Alternate route",
      desc: "Different highway / end-to-end reroute",
      eta: etaB,
      deltaLabel: hasB ? savingsShortVsA(etaA, etaB) : null,
      disabled: !hasB,
    },
  ];

  return (
    <div
      className="traffic-bypass-compare traffic-bypass-compare--compact"
      role="dialog"
      aria-modal="true"
      aria-label="Traffic bypass options"
    >
      <div className="traffic-bypass-compare__header">
        <div className="traffic-bypass-compare__header-main">
          <span className="traffic-bypass-compare__title">Reroute options</span>
          <span className="traffic-bypass-compare__sub">{headline}</span>
        </div>
        <button
          type="button"
          className="traffic-bypass-compare__close"
          onClick={onCancel}
          aria-label="Cancel reroute options"
          title="Cancel"
        >
          ×
        </button>
      </div>
      <p className="traffic-bypass-compare__hint">
        {"Pick "}
        <strong>A</strong>, <strong>B</strong>, or <strong>C</strong>, then tap <strong>Return to drive</strong> to use
        that line and close the map compare.
      </p>
      <div className="traffic-bypass-compare__grid" role="list">
        {options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            role="listitem"
            className={`traffic-bypass-compare__card traffic-bypass-compare__card--${opt.badge.toLowerCase()}${
              selectedLeg === opt.id ? " traffic-bypass-compare__card--selected" : ""
            }`}
            onClick={() => onSelect(opt.id)}
            disabled={opt.disabled}
            title={opt.disabled ? "No route returned for this option" : `Select ${opt.title.toLowerCase()}`}
          >
            <span className="traffic-bypass-compare__card-badge">{opt.badge}</span>
            <span className="traffic-bypass-compare__card-body">
              <span className="traffic-bypass-compare__card-title">{opt.title}</span>
              <span className="traffic-bypass-compare__card-desc">{opt.desc}</span>
              <span className="traffic-bypass-compare__card-meta">
                {opt.eta != null ? (
                  <>
                    <strong>{formatEtaDuration(opt.eta)}</strong>
                    {opt.deltaLabel ? <span className="traffic-bypass-compare__card-delta"> · {opt.deltaLabel}</span> : null}
                  </>
                ) : (
                  <em>Not available</em>
                )}
              </span>
            </span>
          </button>
        ))}
      </div>
      <div className="traffic-bypass-compare__footer">
        <button
          type="button"
          className="traffic-bypass-compare__confirm"
          onClick={onConfirm}
          disabled={selectedLeg == null}
        >
          Return to drive
        </button>
      </div>
    </div>
  );
}
