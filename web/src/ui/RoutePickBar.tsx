import type { NavRoute } from "../nav/types";
import { formatEtaDuration } from "./formatEta";

export type RoutePickItem = {
  id: string;
  letter: string;
  etaMinutes: number;
  suggested: boolean;
  softPath: boolean;
  /** Matches map line color */
  color: string;
};

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return `rgba(100, 116, 139, ${alpha})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function routeLetter(route: NavRoute, index: number): string {
  const m = route.label.match(/route\s*([a-z0-9])/i);
  if (m?.[1]) return m[1]!.toUpperCase();
  return String.fromCharCode(65 + Math.min(index, 25));
}

/** Segmented A|B|C with per-route colors matching the map. */
export function RouteTripleToggle({
  items,
  selectedId,
  onSelect,
}: {
  items: RoutePickItem[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  if (items.length < 1) return null;

  return (
    <div className="nav-route-toggle" role="radiogroup" aria-label="Active route">
      {items.map((it) => {
        const on = selectedId === it.id;
        return (
          <button
            key={it.id}
            type="button"
            role="radio"
            aria-checked={on}
            className={`nav-route-toggle__seg${on ? " nav-route-toggle__seg--on" : ""}${it.suggested ? " nav-route-toggle__seg--suggested" : ""}`}
            style={{
              borderBottomColor: it.color,
              backgroundColor: on ? hexToRgba(it.color, 0.42) : hexToRgba(it.color, 0.08),
              color: on ? "#fff" : "#c4c7ce",
            }}
            title={
              it.suggested
                ? `Route ${it.letter}: ~${it.etaMinutes} min — suggested for conditions`
                : it.softPath
                  ? `Route ${it.letter}: ~${it.etaMinutes} min — no interstate`
                  : `Route ${it.letter}: ~${it.etaMinutes} min`
            }
            onClick={() => onSelect(it.id)}
          >
            {it.letter}
          </button>
        );
      })}
    </div>
  );
}

/** Single control: tap cycles Route A → B → C (colors follow each leg, not list order). */
export function RouteCycleButton({
  items,
  selectedId,
  onSelect,
  detail,
  className = "",
}: {
  items: RoutePickItem[];
  selectedId: string;
  onSelect: (id: string) => void;
  /** Extra line (e.g. distance · strategy) */
  detail?: string;
  className?: string;
}) {
  if (items.length === 0) return null;

  const idx = Math.max(0, items.findIndex((it) => it.id === selectedId));
  const current = items[idx]!;

  const cycle = () => {
    if (items.length < 2) return;
    const next = (idx + 1) % items.length;
    onSelect(items[next]!.id);
  };

  const title = items
    .map(
      (it) =>
        `Route ${it.letter} ~${formatEtaDuration(it.etaMinutes)}${it.suggested ? " (suggested)" : ""}`
    )
    .join(" · ");
  const hint =
    items.length < 2
      ? `${title}. OpenRoute returned one distinct path here; other variants matched this geometry.`
      : `${title}. Tap for next route.`;
  const fullTitle = detail ? `${hint} — ${detail}` : hint;

  return (
    <button
      type="button"
      className={[
        "nav-route-cycle-btn",
        items.length < 2 && "nav-route-cycle-btn--solo",
        detail && "nav-route-cycle-btn--with-detail",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{
        borderColor: current.color,
        background: "#f8fafc",
        color: "#0f172a",
        textShadow: "none",
        boxShadow: "none",
      }}
      title={fullTitle}
      aria-label={
        items.length < 2
          ? `Route ${current.letter}, about ${formatEtaDuration(current.etaMinutes)}. Only one distinct route for this trip.`
          : `Route ${current.letter}, about ${formatEtaDuration(current.etaMinutes)}. Tap to switch route.`
      }
      onClick={cycle}
      disabled={items.length < 2}
    >
      <span className="nav-route-cycle-btn__label">Route {current.letter}</span>
      <span className="nav-route-cycle-btn__eta">~{formatEtaDuration(current.etaMinutes)}</span>
      {detail ? <span className="nav-route-cycle-btn__detail">{detail}</span> : null}
    </button>
  );
}
