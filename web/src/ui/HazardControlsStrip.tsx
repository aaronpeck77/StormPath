import type { ReactNode } from "react";

/**
 * NWS + Road toggles row — mirrors toggles inside the expanded Advisory panel.
 * The Hazards button was retired: the advisory bar itself is now the clickable
 * preview / expand target in all views.
 */
type Props = {
  /**
   * Middle of the strip: idle/busy chip in route/planning view, or the unified drive
   * route-ahead strip in drive view.
   */
  statusSlot?: ReactNode;
  sessionOn: boolean;
  onSessionToggle: (on: boolean) => void;
  roadDetailEnabled: boolean;
  onRoadDetailToggle: (on: boolean) => void;
  hideLayerToggles?: boolean;
};

export function HazardControlsStrip({
  statusSlot,
  sessionOn,
  onSessionToggle,
  roadDetailEnabled,
  onRoadDetailToggle,
  hideLayerToggles = false,
}: Props) {
  // Drive view hides the toggles AND the dedicated status slot carries its own
  // row — in that case the strip has nothing to render and we skip it entirely
  // so we don't add an empty flex row above the advisory bar.
  if (hideLayerToggles && !statusSlot) return null;
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
    </div>
  );
}
