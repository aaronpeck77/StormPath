import type { MapViewMode } from "./DriveMap";

const MODES: { id: MapViewMode; label: string; hint: string }[] = [
  { id: "drive", label: "Drive", hint: "Follow you, road-style" },
  { id: "topdown", label: "Top-down", hint: "Map view, follows puck" },
  { id: "route", label: "Route", hint: "All options overview" },
];

type Props = {
  value: MapViewMode;
  onChange: (m: MapViewMode) => void;
  navigationActive: boolean;
};

export function ViewModeBar({ value, onChange, navigationActive }: Props) {
  return (
    <div className="view-mode-bar" role="tablist" aria-label="Map view">
      {MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          role="tab"
          aria-selected={value === m.id}
          title={m.hint}
          className={`view-mode-btn ${value === m.id ? "active" : ""}`}
          onClick={() => onChange(m.id)}
        >
          {m.label}
        </button>
      ))}
      {!navigationActive && (
        <span className="view-mode-hint">Drive &amp; top-down follow you after you tap Go.</span>
      )}
    </div>
  );
}
