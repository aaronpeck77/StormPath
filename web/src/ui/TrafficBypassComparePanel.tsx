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
  /** When true, confirm reads "Go" (active navigation); otherwise "Use this route". */
  navigationStarted?: boolean;
  /** Override confirm button label (e.g. toll preview during planning). */
  confirmLabel?: string;
  /** Mapbox leg labels (Main, No interstate, etc.) — shown on each card. */
  routeLabels?: Partial<Record<"r-a" | "r-b" | "r-c", string>>;
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
    navigationStarted = false,
    confirmLabel,
    routeLabels,
  } = props;
  const lowConfidence = confidence === "low";
  const label = (id: SlotKey) => routeLabels?.[id]?.trim() || `Route ${id === "r-a" ? "A" : id === "r-b" ? "B" : "C"}`;

  const options: Option[] = [
    {
      id: "r-a",
      badge: "A",
      title: label("r-a"),
      desc: "From your position to destination",
      eta: etaA,
      deltaLabel: null,
      disabled: false,
    },
    {
      id: "r-b",
      badge: "B",
      title: label("r-b"),
      desc: "Second option — different corridor",
      eta: etaB,
      deltaLabel: hasB ? savingsShortVsA(etaA, etaB) : null,
      disabled: !hasB,
    },
  ];
  /* Route C only when a third leg exists — planning is capped at A/B, and toll compare is A vs B. */
  if (hasC) {
    options.push({
      id: "r-c",
      badge: "C",
      title: label("r-c"),
      desc: lowConfidence ? "Third option — compare on map" : "Third option — different corridor",
      eta: etaC,
      deltaLabel: savingsShortVsA(etaA, etaC),
      disabled: false,
    });
  }

  const listLabel = hasC ? "A, B, or C — then confirm" : hasB ? "A or B — then confirm" : "Route A — then confirm";

  return (
    <div
      className="traffic-bypass-compare"
      role="dialog"
      aria-modal="true"
      aria-label="Choose a route"
    >
      <div className="traffic-bypass-compare__header">
        <div className="traffic-bypass-compare__header-main">
          <span className="traffic-bypass-compare__title">Choose a route</span>
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
      <div className="traffic-bypass-compare__grid" role="list" aria-label={listLabel}>
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
          {confirmLabel ?? (navigationStarted ? "Go" : "Use this route")}
        </button>
      </div>
    </div>
  );
}
