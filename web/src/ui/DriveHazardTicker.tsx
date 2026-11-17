import { useEffect, useState } from "react";
import { selectDriveHazardTicker, type DriveHazardTickerInput } from "../nav/driveHazardTicker";
import { LandscapeDockContent } from "./LandscapeNavigationDock";

/** How long a "coming next" flash stays on screen inside a hazard cluster. */
const FLASH_VISIBLE_MS = 6000;

export function DriveHazardTicker(props: DriveHazardTickerInput & {
  bendHazardId?: string | null;
  onBend?: () => void;
  onDismissBend?: () => void;
  /** Tap the countdown → fly to the hazard and open its detail. */
  onPressHazard?: (id: string) => void;
}) {
  const { onPressHazard, bendHazardId, onBend, onDismissBend, ...input } = props;
  const hazard = selectDriveHazardTicker(input);
  const hazardId = hazard?.id ?? null;
  const hazardMode = hazard?.mode ?? null;
  const [flashDoneId, setFlashDoneId] = useState<string | null>(null);
  useEffect(() => {
    setFlashDoneId(null);
    if (hazardMode !== "flash" || hazardId == null) return;
    const t = window.setTimeout(() => setFlashDoneId(hazardId), FLASH_VISIBLE_MS);
    return () => window.clearTimeout(t);
  }, [hazardId, hazardMode]);
  if (!hazard || (hazard.mode === "flash" && flashDoneId === hazard.id)) return null;
  const body = (
    <>
      <span className="drive-hazard-ticker__dot" style={{ backgroundColor: hazard.color }} aria-hidden="true" />
      <span className="drive-hazard-ticker__label" title={hazard.label}>{hazard.label}</span>
      <span className="drive-hazard-ticker__distance">· {hazard.distanceLabel}</span>
      {bendHazardId === hazard.id && onBend ? (
        <span className="drive-hazard-ticker__actions">
          <button type="button" onClick={onBend} title="Review a route bend when stopped or with a passenger; avoidance is not guaranteed">Bend route</button>
          <button type="button" onClick={onDismissBend} aria-label="Dismiss Bend suggestion">Not now</button>
        </span>
      ) : null}
    </>
  );
  const flashClass = hazard.mode === "flash" ? " drive-hazard-ticker--flash" : "";
  return (
    <LandscapeDockContent active={props.navigationStarted}>
      {onPressHazard ? (
        <button
          type="button"
          className={`drive-hazard-ticker drive-hazard-ticker--tap${flashClass}`}
          role="region"
          aria-label={`Next route hazard: ${hazard.label} ${hazard.distanceLabel}`}
          onClick={() => onPressHazard(hazard.id)}
        >
          {body}
        </button>
      ) : (
        <div className={`drive-hazard-ticker${flashClass}`} role="region" aria-label="Next route hazard">
          {body}
        </div>
      )}
    </LandscapeDockContent>
  );
}
