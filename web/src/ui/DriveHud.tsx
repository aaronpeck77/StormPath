import type { FusedSituationSnapshot } from "../situation/types";
import { formatEtaDuration } from "./formatEta";

type Props = {
  speedMph: number | null;
  postedMph: number | null;
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
          <span
            className="drive-hud-v"
            title={
              postedMph != null
                ? "Map estimate only — obey posted signs"
                : "No reliable map limit — obey posted signs"
            }
          >
            {postedMph != null ? postedMph : "—"}
            <small>{postedMph != null ? " est" : " mph"}</small>
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