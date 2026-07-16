import { clearDevLocationOverride } from "../hooks/useUserLocation";
import { safeStorage } from "../storage/safeStorage";

type Props = {
  hasMapboxToken: boolean;
  isNetlifyHost: boolean;
  devLocOverrideLngLat: [number, number] | null;
  locationFixSource: string | null | undefined;
  locationError: string | null;
  routeError: string | null;
  tapHint: string | null;
  safetyAck: boolean;
  onSafetyAck: () => void;
  onReportIssue: (() => void) | null;
  isOnline: boolean;
  navigationStarted: boolean;
  hasPlanRoutes: boolean;
  hasDest: boolean;
  driveModeUi: boolean;
  isPlus: boolean;
  demoBypassTrafficJamPlus: boolean;
  demoPlaybackPlaying: boolean;
  demoApproachBannerOn: boolean;
  demoCloseHazardOn: boolean;
  trafficBypassCompareOpen: boolean;
  onToggleDemoPlayback: () => void;
  onResetDemoPlayback: () => void;
  onToggleDemoApproachBanner: () => void;
  onToggleDemoCloseHazard: () => void;
  onOpenDemoCompare: () => void;
};

/** Top/dock toasts, safety ack, offline banner, and optional demo tools strip. */
export function AppStatusBanners(props: Props) {
  const {
    hasMapboxToken,
    isNetlifyHost,
    devLocOverrideLngLat,
    locationFixSource,
    locationError,
    routeError,
    tapHint,
    safetyAck,
    onSafetyAck,
    onReportIssue,
    isOnline,
    navigationStarted,
    hasPlanRoutes,
    hasDest,
    driveModeUi,
    isPlus,
    demoBypassTrafficJamPlus,
    demoPlaybackPlaying,
    demoApproachBannerOn,
    demoCloseHazardOn,
    trafficBypassCompareOpen,
    onToggleDemoPlayback,
    onResetDemoPlayback,
    onToggleDemoApproachBanner,
    onToggleDemoCloseHazard,
    onOpenDemoCompare,
  } = props;

  return (
    <>
      {!hasMapboxToken && (
        <div className="nav-toast-stack nav-toast-stack--top" aria-live="polite">
          <div className="nav-toast nav-toast-warn" role="status">
            {isNetlifyHost
              ? "Map unavailable — add VITE_MAPBOX_TOKEN in Netlify env vars (Builds scope), then redeploy."
              : "Add VITE_MAPBOX_TOKEN in web/.env.local."}
          </div>
        </div>
      )}

      {import.meta.env.DEV && devLocOverrideLngLat && (
        <div className="nav-toast-stack nav-toast-stack--top" aria-live="polite">
          <div className="nav-toast nav-toast-warn" role="status">
            <strong>Dev pinned location</strong> — the browser never asks for GPS.{" "}
            <button
              type="button"
              className="nav-toast-inline-btn"
              onClick={() => {
                clearDevLocationOverride();
                window.location.hash = "";
                window.location.reload();
              }}
            >
              Use real GPS
            </button>
          </div>
        </div>
      )}

      {import.meta.env.DEV && locationFixSource === "dev-ip" && (
        <div className="nav-toast-stack nav-toast-stack--top" role="status">
          <div className="nav-toast nav-toast-warn">
            <strong>Approximate dev position (ISP / metro)</strong> — not GPS. Open{" "}
            <code>http://localhost:5173</code> on this computer, or use the native app, for a real fix.
          </div>
        </div>
      )}

      {(locationError || routeError) && (
        <div className="nav-toast-stack nav-toast-stack--top" aria-live="assertive">
          {locationError ? (
            <div className="nav-toast nav-toast-err" role="alert">
              {locationError}
            </div>
          ) : null}
          {routeError ? (
            <div className="nav-toast nav-toast-err" role="alert">
              {routeError}
            </div>
          ) : null}
        </div>
      )}

      {tapHint ? (
        <div className="nav-toast-stack nav-toast-stack--dock" role="status" aria-live="polite">
          <div className="nav-toast nav-toast-warn">{tapHint}</div>
        </div>
      ) : null}

      {!safetyAck && (
        <div className="nav-safety-banner" role="dialog" aria-label="Safety notice">
          <div className="nav-safety-banner__text">
            Do not use StormPath while driving. Use a passenger or pull over. Always follow official warnings and road
            closures.
          </div>
          <div className="nav-safety-banner__actions">
            {onReportIssue ? (
              <button
                type="button"
                className="nav-safety-banner__btn nav-safety-banner__btn--ghost"
                onClick={onReportIssue}
              >
                Report issue
              </button>
            ) : null}
            <button
              type="button"
              className="nav-safety-banner__btn"
              onClick={() => {
                safeStorage.set("stormpath-safety-ack-v1", "1");
                onSafetyAck();
              }}
            >
              OK
            </button>
          </div>
        </div>
      )}

      {!isOnline && (navigationStarted || hasPlanRoutes || hasDest) && (
        <div
          className={`nav-offline-banner${driveModeUi ? " nav-offline-banner--drive" : ""}`}
          role="status"
          aria-live="polite"
        >
          {driveModeUi
            ? isPlus
              ? "Offline — cached route; no live traffic, weather, or storm updates."
              : "Offline — cached route; map and radar may be limited until you reconnect."
            : isPlus
              ? "Offline — showing last route. Live updates paused (traffic, weather, storm). See About if layers stay empty after you reconnect."
              : "Offline — showing last route. Reconnect for map tiles and radar. See About if layers stay empty."}
        </div>
      )}

      {demoBypassTrafficJamPlus && driveModeUi && navigationStarted && (
        <div className="nav-demo-bypass-banner" role="region" aria-label="Plus traffic bypass demo tools">
          <div className="nav-demo-bypass-banner__top">
            <span className="nav-demo-bypass-banner__short">Demo</span>
            <div className="nav-demo-bypass-banner__actions">
              <button type="button" className="nav-demo-bypass-banner__btn" onClick={onToggleDemoPlayback}>
                {demoPlaybackPlaying ? "Pause" : "Play"}
              </button>
              <button type="button" className="nav-demo-bypass-banner__btn" onClick={onResetDemoPlayback}>
                Reset puck
              </button>
              <button
                type="button"
                className="nav-demo-bypass-banner__btn"
                onClick={onToggleDemoApproachBanner}
                disabled={trafficBypassCompareOpen}
              >
                {demoApproachBannerOn && !demoCloseHazardOn ? "Hide banner" : "Mock banner"}
              </button>
              <button
                type="button"
                className="nav-demo-bypass-banner__btn"
                onClick={onToggleDemoCloseHazard}
                disabled={trafficBypassCompareOpen}
              >
                {demoCloseHazardOn ? "Hide close" : "Mock close hazard"}
              </button>
              <button
                type="button"
                className="nav-demo-bypass-banner__btn"
                onClick={onOpenDemoCompare}
                disabled={trafficBypassCompareOpen}
              >
                Mock compare
              </button>
            </div>
          </div>
          <details className="nav-demo-bypass-banner__details">
            <summary className="nav-demo-bypass-banner__summary">Demo notes</summary>
            <div className="nav-demo-bypass-banner__text">
              URL flag <code>?demo=bypass</code>. <strong>Play</strong> moves the puck at estimated MPH from turn text.{" "}
              <strong>Mock banner</strong> shows the approach strip with a fake impact ~1.4 mi ahead — tap it to jump
              to the mock compare. <strong>Mock close hazard</strong> drops one ~0.6 mi ahead so the surgical bypass
              runs in its <em>next-exit</em> tier (tighter exit/rejoin window). <strong>Mock compare</strong> opens
              the A/B panel directly (no Mapbox call).
            </div>
          </details>
        </div>
      )}
    </>
  );
}
