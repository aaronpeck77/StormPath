import { selectDriveHazardTicker, type DriveHazardTickerInput } from "../nav/driveHazardTicker";
import { LandscapeDockContent } from "./LandscapeNavigationDock";

export function DriveHazardTicker(props: DriveHazardTickerInput & {
  bendHazardId?: string | null;
  onBend?: () => void;
  onDismissBend?: () => void;
}) {
  const hazard = selectDriveHazardTicker(props);
  if (!hazard) return null;
  return (
    <LandscapeDockContent active={props.navigationStarted}>
    <div className="drive-hazard-ticker" role="region" aria-label="Next route hazard">
      <span className="drive-hazard-ticker__dot" style={{ backgroundColor: hazard.color }} aria-hidden="true" />
      <span className="drive-hazard-ticker__label" title={hazard.label}>{hazard.label}</span>
      <span className="drive-hazard-ticker__distance">· {hazard.distanceLabel}</span>
      {props.bendHazardId === hazard.id && props.onBend ? (
        <span className="drive-hazard-ticker__actions">
          <button type="button" onClick={props.onBend} title="Review a route bend when stopped or with a passenger; avoidance is not guaranteed">Bend route</button>
          <button type="button" onClick={props.onDismissBend} aria-label="Dismiss Bend suggestion">Not now</button>
        </span>
      ) : null}
    </div>
    </LandscapeDockContent>
  );
}
