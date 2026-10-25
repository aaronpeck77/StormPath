import { selectDriveHazardTicker, type DriveHazardTickerInput } from "../nav/driveHazardTicker";

export function DriveHazardTicker(props: DriveHazardTickerInput) {
  const hazard = selectDriveHazardTicker(props);
  if (!hazard) return null;
  return (
    <div className="drive-hazard-ticker" role="region" aria-label="Next route hazard">
      <span className="drive-hazard-ticker__dot" style={{ backgroundColor: hazard.color }} aria-hidden="true" />
      <span className="drive-hazard-ticker__label" title={hazard.label}>{hazard.label}</span>
      <span className="drive-hazard-ticker__distance">· {hazard.distanceLabel}</span>
    </div>
  );
}
