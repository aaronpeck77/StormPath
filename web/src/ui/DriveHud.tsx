import type { FusedSituationSnapshot } from "../situation/types";
import { formatEtaDuration } from "./formatEta";

type Props = {
  speedMph: number | null;
  postedMph: number;
  etaMinutes: number;
  distanceMi: number;
  tripElapsedLabel: string;
  activeSlice: FusedSituationSnapshot["routes"][0] | undefined;
  statusSummary: string;
  rerouteMessage: string | null;
  onAcceptReroute: (() => void) | null;
  onStopNavigation: () => void;
};

export function DriveHud({
  speedMph,
  postedMph,
  etaMinutes,
  distanceMi,
  tripElapsedLabel,
  activeSlice,
  statusSummary,
  rerouteMessage,
  onAcceptReroute,
  onStopNavigation,
}: Props) {
  const spd = speedMph != null ? Math.round(speedMph) : "—";

  return (
    <div className="drive-hud" role="region" aria-label="Driving information">
      <div className="drive-hud-grid">
        <div className="drive-hud-cell">
          <span className="drive-hud-k">Speed</span>
          <span className="drive-hud-v">
            {spd}
            <small> mph</small>
          </span>
        </div>
        <div className="drive-hud-cell">
          <span className="drive-hud-k">Limit</span>
          <span className="drive-hud-v">
            {postedMph}
            <small> mph</small>
          </span>
        </div>
        <div className="drive-hud-cell">
          <span className="drive-hud-k">ETA</span>
          <span className="drive-hud-v">{formatEtaDuration(etaMinutes)}</span>
        </div>
        <div className="drive-hud-cell">
          <span className="drive-hud-k">Dist</span>
          <span className="drive-hud-v">{distanceMi.toFixed(1)} mi</span>
        </div>
        <div className="drive-hud-cell wide">
          <span className="drive-hud-k">Trip time</span>
          <span className="drive-hud-v">{tripElapsedLabel}</span>
        </div>
      </div>

      <div className="drive-hud-ahead">
        <p className="drive-hud-ahead-title">Road &amp; weather ahead</p>
        <p className="drive-hud-ahead-body">{statusSummary}</p>
        {activeSlice && (
          <p className="drive-hud-ahead-sub">{activeSlice.forecastHeadline}</p>
        )}
      </div>

      {rerouteMessage && (
        <div className="drive-hud-reroute" role="alert">
          <p>{rerouteMessage}</p>
          {onAcceptReroute && (
            <button type="button" className="drive-hud-reroute-btn" onClick={onAcceptReroute}>
              Use suggested route
            </button>
          )}
        </div>
      )}

      <div className="drive-hud-tools">
        <button type="button" className="drive-hud-tool danger" onClick={onStopNavigation}>
          Stop
        </button>
      </div>
    </div>
  );
}

/**
 * Rough speed limit from movement + maneuver text (not Mapbox maxspeed / exit lanes).
 * Updates as instructions mention highways / ramps / local roads.
 */
export function estimatePostedSpeedMph(
  speedMph: number | null,
  turnSteps: { instruction: string }[],
  activeIndex: number
): number {
  const instr = (turnSteps[activeIndex]?.instruction ?? "").toLowerCase();
  const highway =
    /\b(i-|interstate|us-\d|sr-\d|state route|freeway|expressway|turnpike|parkway)\b/i.test(
      instr
    ) || /\btake (the |your )?(exit|ramp)\b/i.test(instr);
  const slowStreet =
    /\broundabout|rotary|traffic circle|destination|arrive|parking|alley\b/i.test(instr);

  if (highway) {
    if (speedMph != null && speedMph > 60) return 70;
    return 65;
  }
  if (slowStreet) return 25;
  if (speedMph == null || speedMph < 6) return 35;
  if (speedMph >= 52) return 55;
  if (speedMph >= 38) return 45;
  if (speedMph >= 24) return 35;
  return 30;
}
