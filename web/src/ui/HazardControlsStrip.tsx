import type { ReactNode } from "react";

/**
 * NWS + Road + Hazards row — mirrors toggles inside the expanded Advisory panel.
 */
type Props = {
  /**
   * Middle of the strip: idle/busy chip in route/planning view, or the unified drive
   * route-ahead + Hazards shortcut in drive view.
   */
  statusSlot?: ReactNode;
  sessionOn: boolean;
  onSessionToggle: (on: boolean) => void;
  roadDetailEnabled: boolean;
  onRoadDetailToggle: (on: boolean) => void;
  hideLayerToggles?: boolean;
  advisoryExpanded: boolean;
  onAdvisoryToggle: () => void;
  peekBadge: number | null;
  hasSessionError: boolean;
  errorTitle: string | null;
};

export function HazardControlsStrip({
  statusSlot,
  sessionOn,
  onSessionToggle,
  roadDetailEnabled,
  onRoadDetailToggle,
  hideLayerToggles = false,
  advisoryExpanded,
  onAdvisoryToggle,
  peekBadge,
  hasSessionError,
  errorTitle,
}: Props) {
  return (
    <div
      className={`hazard-controls-strip${hideLayerToggles ? " hazard-controls-strip--drive-unified" : ""}`}
      role="toolbar"
      aria-label="Weather and road map layers"
    >
      {!hideLayerToggles && (
        <>
          <label
            className="hazard-controls-strip__nws"
            onPointerDownCapture={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <input type="checkbox" checked={sessionOn} onChange={(e) => onSessionToggle(e.target.checked)} />
            <span>NWS</span>
          </label>
          <label
            className="hazard-controls-strip__road"
            onPointerDownCapture={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <input type="checkbox" checked={roadDetailEnabled} onChange={(e) => onRoadDetailToggle(e.target.checked)} />
            <span>Road</span>
          </label>
        </>
      )}
      {statusSlot}
      <button
        type="button"
        className={`hazard-controls-strip__hazards${hasSessionError ? " hazard-controls-strip__hazards--err" : ""}`}
        onPointerDownCapture={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onAdvisoryToggle();
        }}
        aria-expanded={advisoryExpanded}
        aria-controls="storm-advisory-panel"
        aria-label={
          advisoryExpanded
            ? "Close hazards advisory"
            : peekBadge != null
              ? `Open hazards advisory — ${peekBadge} NWS overlap${peekBadge === 1 ? "" : "s"} along route`
              : "Open hazards advisory"
        }
        title={
          hasSessionError && errorTitle
            ? errorTitle
            : advisoryExpanded
              ? "Close advisory panel"
              : "Open hazards — NWS and road & traffic details"
        }
      >
        <span className="hazard-controls-strip__hazards-text">Hazards</span>
        {peekBadge != null && (
          <span className="hazard-controls-strip__badge hazard-controls-strip__badge--in-btn" aria-hidden>
            {peekBadge}
          </span>
        )}
      </button>
    </div>
  );
}
