import type { MapViewMode } from "./DriveMap";
import { useEffect, useMemo, useState } from "react";
import {
  formatArrivalClockCompact,
  formatEtaDuration,
  formatEtaDurationToolbar,
} from "./formatEta";

const VIEW_CYCLE: { mode: MapViewMode; label: string; line: string }[] = [
  { mode: "route", label: "Rt", line: "#3b82f6" },
  { mode: "drive", label: "Dr", line: "#22c55e" },
  { mode: "topdown", label: "Mp", line: "#a855f7" },
];

function hexToRgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return `rgba(100, 116, 139, ${a})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

type Props = {
  viewMode: MapViewMode;
  onViewMode: (m: MapViewMode) => void;
  onOpenSaved: () => void;
  navigationStarted: boolean;
  onGo: () => void;
  showGo: boolean;
  speedMph: number | null;
  postedMph: number;
  onStop: () => void;
  hasTrip: boolean;
  /** ★ in route / map (topdown): shown while navigating; hidden in drive only (saves bar space) */
  showSavedPlacesButton: boolean;
  /** Rt/Mp/Dr cycle — set false to hide entirely */
  showViewCycleButton?: boolean;
  /** Rt/Dr/Mp cycle only after Go — planning stays in route view with control disabled */
  viewCycleDisabled?: boolean;
  /** Active leg ETA while driving (minutes, fused score) */
  driveEtaMinutes: number | null;
  showRadar: boolean;
  onToggleRadar: () => void;
  /** When false, hide the Rad button entirely (not just inactive). */
  showRadarButton?: boolean;
  radarEnabled?: boolean;
  /** Far off the polyline — manual reroute from GPS */
  offRouteSevere?: boolean;
  onRerouteFromHere?: () => void;
  /** When false, hide the off-route strip (e.g. drive auto-reroutes, or Rt/Mp when auto is on). */
  showOffRouteBanner?: boolean;
  /** Traffic bypass (moved off progress bar) */
  showTrafficBypass?: boolean;
  bypassBusy?: boolean;
  onTrafficBypass?: () => void;
};

export function BottomToolbar({
  viewMode,
  onViewMode,
  onOpenSaved,
  navigationStarted,
  onGo,
  showGo,
  speedMph,
  postedMph,
  onStop,
  hasTrip,
  showSavedPlacesButton,
  showViewCycleButton = true,
  viewCycleDisabled = false,
  driveEtaMinutes,
  showRadar,
  onToggleRadar,
  showRadarButton = true,
  radarEnabled = true,
  offRouteSevere = false,
  onRerouteFromHere,
  showOffRouteBanner = true,
  showTrafficBypass = false,
  bypassBusy = false,
  onTrafficBypass,
}: Props) {
  const viewEntry = VIEW_CYCLE.find((v) => v.mode === viewMode) ?? VIEW_CYCLE[0]!;
  const cycleViewMode = () => {
    const i = VIEW_CYCLE.findIndex((v) => v.mode === viewMode);
    const next = VIEW_CYCLE[(i + 1) % VIEW_CYCLE.length]!;
    onViewMode(next.mode);
  };

  /** Wall-clock tick so arrival time stays honest; also resets when live ETA changes. */
  const [etaTickMs, setEtaTickMs] = useState(() => Date.now());
  useEffect(() => {
    if (!navigationStarted) return;
    setEtaTickMs(Date.now());
    const id = window.setInterval(() => setEtaTickMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [navigationStarted, driveEtaMinutes]);

  const arrivalAtMs = useMemo(() => {
    const m = driveEtaMinutes ?? 0;
    if (m <= 0) return null;
    return etaTickMs + Math.round(m) * 60_000;
  }, [etaTickMs, driveEtaMinutes]);

  const driveNavUi = navigationStarted && viewMode === "drive";
  const mapNavUi = navigationStarted && viewMode === "topdown";
  const routeUi = viewMode === "route";
  const [drivePhoneLayout, setDrivePhoneLayout] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 520px)").matches
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 520px)");
    const apply = () => setDrivePhoneLayout(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  /** Heuristic limit from turn context + GPS — not a legal speed sign. Small buffer reduces GPS jitter. */
  const SPEED_OVER_BUFFER_MPH = 3;
  const speedOverPosted =
    speedMph != null && postedMph > 0 && speedMph > postedMph + SPEED_OVER_BUFFER_MPH;

  return (
    <div
      className={`nav-bottom-toolbar${driveNavUi ? " nav-bottom-toolbar--drive" : ""}${
        driveNavUi && drivePhoneLayout ? " nav-bottom-toolbar--drive-phone" : ""
      }${mapNavUi ? " nav-bottom-toolbar--mapnav" : ""}${
        mapNavUi && drivePhoneLayout ? " nav-bottom-toolbar--mapnav-phone" : ""
      }${routeUi ? " nav-bottom-toolbar--route" : ""}`}
      aria-label="Map and trip controls"
    >
      {showOffRouteBanner && offRouteSevere && onRerouteFromHere && (
        <div className="nav-bottom-off-route" role="alert">
          <span className="nav-bottom-off-route__text">Off route — reroute from here?</span>
          <button type="button" className="nav-bottom-off-route__btn" onClick={onRerouteFromHere}>
            Reroute
          </button>
        </div>
      )}
      {navigationStarted && showTrafficBypass && onTrafficBypass && (
        <div className="nav-bottom-bypass-chip">
          <button
            type="button"
            className="nav-bottom-bypass-chip__btn"
            disabled={bypassBusy}
            onClick={onTrafficBypass}
          >
            {bypassBusy ? "Bypass…" : "Traffic bypass"}
          </button>
        </div>
      )}
      <div className="nav-bottom-toolbar__main">
        <div className="nav-bottom-toolbar__left">
          {navigationStarted && (
            <div className="nav-bottom-stats-row nav-bottom-stats-row--lead" aria-label="Speed and limit">
              <div className="nav-bottom-stat">
                <span className="nav-bottom-stat-k">Spd</span>
                <span
                  className={`nav-bottom-stat-v${speedOverPosted ? " nav-bottom-stat-v--speed-over" : ""}`}
                  title={speedOverPosted ? "Estimated over heuristic limit — follow posted signs" : undefined}
                >
                  {speedMph != null ? Math.round(speedMph) : "—"}
                  <small> mph</small>
                </span>
              </div>
              <div className="nav-bottom-stat">
                <span className="nav-bottom-stat-k">Lim</span>
                <span className="nav-bottom-stat-v">{postedMph}</span>
              </div>
            </div>
          )}
        </div>

        <div className="nav-bottom-toolbar__center">
          <div className="nav-bottom-toolbar__modes">
            {showViewCycleButton && (
              <button
                type="button"
                title={
                  viewCycleDisabled
                    ? "Tap Go to start — then you can switch between Route, Drive, and Map view."
                    : `${viewEntry.label}: ${viewEntry.mode === "route" ? "Route overview" : viewEntry.mode === "drive" ? "Drive / navigation" : "Map top-down"}. Tap for next view.`
                }
                className="nav-mode-cycle"
                disabled={viewCycleDisabled}
                style={
                  viewCycleDisabled
                    ? {
                        borderColor: "rgba(255, 255, 255, 0.22)",
                        background: "rgba(71, 85, 105, 0.35)",
                        boxShadow: "none",
                      }
                    : {
                        borderColor: viewEntry.line,
                        background: hexToRgba(viewEntry.line, 0.22),
                        boxShadow: "none",
                      }
                }
                onClick={cycleViewMode}
              >
                <span className="nav-mode-cycle__label">{viewEntry.label}</span>
                <span className="nav-mode-cycle__hint">view</span>
              </button>
            )}
            {/* Rad: route + map (topdown) while navigating; hidden in drive to save bar space */}
            {!driveNavUi && showRadarButton && (
              <button
                type="button"
                title={
                  radarEnabled
                    ? "Animated precipitation radar (recent ~2 h of mosaics, ~10 min steps)"
                    : "Radar disabled in Settings"
                }
                className={`nav-mode-sq nav-mode-sq--radar${showRadar ? " active" : ""}`}
                onClick={radarEnabled ? onToggleRadar : undefined}
                disabled={!radarEnabled}
              >
                Rad
              </button>
            )}
            {routeUi && showGo && (
              <button type="button" className="nav-mode-sq nav-mode-sq--go" onClick={onGo} title="Start navigation">
                Go
              </button>
            )}
            {showSavedPlacesButton && (
              <button
                type="button"
                title="Saved places"
                className="nav-mode-sq nav-mode-sq--saved"
                onClick={onOpenSaved}
              >
                ★
              </button>
            )}
            {navigationStarted && (
              <button type="button" className="nav-bottom-tool nav-bottom-tool--stop" onClick={onStop}>
                Stop
              </button>
            )}
            {routeUi && !navigationStarted && hasTrip && (
              <button type="button" className="nav-bottom-tool nav-bottom-tool--stop" onClick={onStop}>
                Stop
              </button>
            )}
          </div>
        </div>

        <div className="nav-bottom-toolbar__right">
          {!routeUi && showGo && (
            <button type="button" className="nav-bottom-go" onClick={onGo}>
              Go
            </button>
          )}

          {!routeUi && !navigationStarted && hasTrip && (
            <button type="button" className="nav-bottom-tool nav-bottom-tool--stop nav-bottom-tool--solo" onClick={onStop}>
              Stop
            </button>
          )}

          {navigationStarted && (
            <>
              {driveEtaMinutes != null && driveEtaMinutes > 0 && arrivalAtMs != null && (
                <div
                  className="nav-bottom-toolbar__drive-meta"
                  aria-label={`ETA ${formatArrivalClockCompact(arrivalAtMs)}, ${formatEtaDuration(driveEtaMinutes)} remaining`}
                >
                  <div className="nav-bottom-toolbar__drive-eta-compact">
                    <span className="nav-bottom-toolbar__drive-eta-line nav-bottom-toolbar__drive-eta-line--arrival">
                      <span className="nav-bottom-toolbar__drive-eta-prefix">ETA </span>
                      <span className="nav-bottom-toolbar__drive-eta-clock">
                        {formatArrivalClockCompact(arrivalAtMs)}
                      </span>
                    </span>
                    <span className="nav-bottom-toolbar__drive-eta-line nav-bottom-toolbar__drive-eta-line--remaining">
                      {formatEtaDurationToolbar(driveEtaMinutes)}
                    </span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
