import { useEffect, useMemo, useState } from "react";
import type { PurchasesPackage } from "@revenuecat/purchases-capacitor";
import { getPayTier, PAY_TIER_OVERRIDE_LS_KEY } from "../billing/payFeatures";
import { useRevenueCat } from "../billing/useRevenueCat";
import { getWebEnv } from "../config/env";
import { isCrashReportingEnabled } from "../monitoring/sentry";
import { stormpathVersionChipLabel, stormpathVersionLabel } from "../appVersion";
import { safeStorage } from "../storage/safeStorage";
import { MapKeyPanel } from "./MapKeyPanel";
import type { HomeMapFraming } from "../map/homeMapFraming";
import type { HomePuckFollowMode } from "../map/homePuckFollow";

type ActivityTrailPanel = {
  count: number;
  spanDays: number | null;
  oldestLabel: string;
  newestLabel: string;
  /** Master opt-in: when off, no new dots are recorded and nothing is ranked / framed by the trail. */
  learnEnabled: boolean;
  onLearnEnabledChange: (on: boolean) => void;
  showOnMap: boolean;
  onShowOnMapChange: (on: boolean) => void;
  /** Launch / idle map: auto, GPS street view, or usual driving area (when enough dots). */
  homeMapFraming: HomeMapFraming;
  onHomeMapFramingChange: (mode: HomeMapFraming) => void;
  /** Enough trail dots to offer “usual area” home framing. */
  homeAreaAvailable: boolean;
  /** Wi‑Fi tile cache warm over density-capped home region. */
  homePreloadEnabled: boolean;
  onHomePreloadEnabledChange: (on: boolean) => void;
  homePreloadAvailable: boolean;
  homePreloadSizeLabel: string | null;
  onClear: () => void;
};

type Props = {
  open: boolean;
  onClose: () => void;
  /** Bumped from App after dev tier override so `getPayTier()` is reflected in About without reload. */
  payTierProbeKey?: number;
  /** When set (dev + most prod builds), run after mutating {@link PAY_TIER_OVERRIDE_LS_KEY} so the app re-reads tier. */
  onPayTierOverride?: () => void;
  /** Plus: sparse GPS dot history on this device — stats + map overlay toggle */
  activityTrail?: ActivityTrailPanel | null;
  /** Home screen (no trip): keep puck centered vs free map panning. */
  homePuckFollow: HomePuckFollowMode;
  onHomePuckFollowChange: (mode: HomePuckFollowMode) => void;
  settings: {
    radarEnabled: boolean;
    stormEnabled: boolean;
    trafficEnabled: boolean;
    weatherHintsEnabled: boolean;
    dataSaverEnabled: boolean;
    autoRerouteEnabled: boolean;
    voiceGuidanceEnabled: boolean;
    gpsHighRefreshEnabled: boolean;
    /** Landscape / side view only — portrait layout ignores this */
    landscapeSideHand: "right" | "left";
  };
  onSettings: (next: Props["settings"]) => void;
  /** Replays the first-launch coachmark walk-through. Resets the suppression flag and asks
   * App.tsx to show the tour again. About sheet closes itself before the tour starts. */
  onReplayCoachmarks?: () => void;
};

/**
 * Map “About” — version, subscription tier, credits, and placeholders for store submission (privacy/terms/support).
 */
export function AboutSheet({
  open,
  onClose,
  payTierProbeKey = 0,
  onPayTierOverride,
  activityTrail = null,
  homePuckFollow,
  onHomePuckFollowChange,
  settings,
  onSettings,
  onReplayCoachmarks,
}: Props) {
  const dev = import.meta.env.DEV;
  const tier = useMemo(() => getPayTier(), [open, payTierProbeKey]);
  const tierLabel = tier === "plus" ? "Plus" : "Basic";
  const plus = tier === "plus";
  const payTierOverrideMode = useMemo((): "none" | "free" | "plus" => {
    if (!onPayTierOverride) return "none";
    const v = safeStorage.get(PAY_TIER_OVERRIDE_LS_KEY)?.toLowerCase();
    if (v === "free") return "free";
    if (v === "plus" || v === "pro") return "plus";
    return "none";
  }, [onPayTierOverride, open, payTierProbeKey]);
  const env = useMemo(() => getWebEnv(), []);
  const [supportNote, setSupportNote] = useState("");
  /* Phase 7 — native IAP through RevenueCat. `iap.ready` is true only when configure
   * resolved successfully (native + non-empty `VITE_REVENUECAT_API_KEY_IOS`); when false,
   * the panel below falls back to the existing `env.upgradeUrl` link. */
  const iap = useRevenueCat();
  /* Clear any leftover purchase / restore banner the next time the sheet reopens. */
  useEffect(() => {
    if (!open) iap.clearMessage();
  }, [open, iap]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    setSupportNote("");
  }, [open]);

  const [activityTrailClearStep, setActivityTrailClearStep] = useState<"idle" | "confirm">("idle");
  const [activityTrailClearAck, setActivityTrailClearAck] = useState(false);
  useEffect(() => {
    if (!open) {
      setActivityTrailClearStep("idle");
      setActivityTrailClearAck(false);
    }
  }, [open]);

  if (!open) return null;

  const versionLabel = stormpathVersionLabel({ dev });
  const diagnosticsLines = [
    `StormPath ${versionLabel}`,
    `Plan: ${tierLabel}`,
    `Crash reporting: ${isCrashReportingEnabled() ? "on (automatic for serious errors)" : "off"}`,
    `Online: ${typeof navigator === "undefined" ? "unknown" : navigator.onLine ? "yes" : "no"}`,
    `Voice: ${settings.voiceGuidanceEnabled ? "on" : "off"}, GPS refresh: ${
      settings.gpsHighRefreshEnabled ? "high" : "normal"
    }, Data saver: ${settings.dataSaverEnabled ? "on" : "off"}`,
    `Landscape UI: ${settings.landscapeSideHand === "left" ? "left hand" : "right hand"}`,
    `Providers: mapbox=${env.mapboxToken ? "on" : "off"}, openweather=${
      env.openWeatherApiKey ? "on" : "off"
    }, tomorrowIo=${env.tomorrowIoApiKey ? "on" : "off"}`,
  ];
  const diagnosticsText = diagnosticsLines.join("\n");
  const supportEmail = env.supportEmail.trim();

  return (
    <>
      <div className="about-sheet-scrim" role="presentation" onClick={onClose} />
      <div
        className="about-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-sheet-title"
      >
        <header className="about-sheet__header">
          <div className="about-sheet__header-top">
            <div className="about-sheet__header-title">
              <h2 id="about-sheet-title" className="about-sheet__title">
                StormPath
              </h2>
              <p className="about-sheet__tagline">Multi-route driving with live conditions on your route.</p>
            </div>
            <button type="button" className="about-sheet__close" onClick={onClose} aria-label="Close info">
              Close
            </button>
          </div>
          <div className="about-sheet__header-meta">
            <span
              className="about-sheet__chip"
              title={
                dev
                  ? "Local dev — semver from package.json; TestFlight build numbers appear in shipped IPAs only."
                  : "Matches TestFlight: version from package.json, build number from CI (same as TestFlight list)."
              }
            >
              {stormpathVersionChipLabel({ dev })}
            </span>
            <span
              className={`about-sheet__chip about-sheet__chip--tier${
                plus ? " about-sheet__chip--plus" : " about-sheet__chip--basic"
              }`}
            >
              {tierLabel}
            </span>
          </div>
        </header>

        {onPayTierOverride ? (
          <div
            className="about-sheet__tier-preview about-sheet__panel about-sheet__panel--devtools"
            role="group"
            aria-label="Test pay tier override"
          >
            <p className="about-sheet__tier-preview-label">Test pay tier</p>
            <div className="about-sheet__tier-preview-btns">
              <button
                type="button"
                className={`about-sheet__tier-preview-btn${
                  payTierOverrideMode === "free" ? " about-sheet__tier-preview-btn--active" : ""
                }`}
                onClick={() => {
                  safeStorage.set(PAY_TIER_OVERRIDE_LS_KEY, "free");
                  onPayTierOverride?.();
                }}
              >
                Basic
              </button>
              <button
                type="button"
                className={`about-sheet__tier-preview-btn${
                  payTierOverrideMode === "plus" ? " about-sheet__tier-preview-btn--active" : ""
                }`}
                onClick={() => {
                  safeStorage.set(PAY_TIER_OVERRIDE_LS_KEY, "plus");
                  onPayTierOverride?.();
                }}
              >
                Plus
              </button>
              <button
                type="button"
                className={`about-sheet__tier-preview-btn${
                  payTierOverrideMode === "none" ? " about-sheet__tier-preview-btn--active" : ""
                }`}
                onClick={() => {
                  safeStorage.remove(PAY_TIER_OVERRIDE_LS_KEY);
                  onPayTierOverride?.();
                }}
              >
                Build default
              </button>
            </div>
            <p className="about-sheet__tier-preview-hint">
              Sets <code className="saved-drawer-code">{PAY_TIER_OVERRIDE_LS_KEY}</code> (same as{" "}
              <code className="saved-drawer-code">getPayTier()</code>). Shown in Vite dev, or in production only when{" "}
              <code className="saved-drawer-code">VITE_PAY_TIER_TEST_PANEL=true</code> (internal QA). Store review
              builds should leave that unset. <strong>Build default</strong> removes the override (dev → Plus unless{" "}
              <code className="saved-drawer-code">VITE_PAY_TIER</code> says otherwise).
            </p>
          </div>
        ) : null}

        <div className="about-sheet__sections">
          <section className="about-sheet__panel about-sheet__panel--subscription">
            <h3 className="about-sheet__h3">Subscription</h3>
            <p className="about-sheet__p">
              You can manage or cancel anytime. Changes apply at the end of the billing period.
            </p>
            <div className="about-sheet__upgrade-actions">
              {!plus && (
                <>
                  {iap.ready ? (
                    /* Native IAP path: the in-app "Subscribe" button. RevenueCat handles
                     * the App Store sheet, receipt validation, and family sharing for us;
                     * the customer-info listener in `revenueCat.ts` flips the entitlement
                     * via `setNativePlusEntitlementActive` and dispatches the global event
                     * App.tsx listens for. */
                    <button
                      type="button"
                      className="about-sheet__upgrade-btn"
                      onClick={() => void iap.purchase()}
                      disabled={iap.busy || !iap.defaultPackage}
                    >
                      {iap.busy
                        ? "Working…"
                        : iap.defaultPackage
                        ? formatSubscribeButtonLabel(iap.defaultPackage)
                        : "Loading subscription…"}
                    </button>
                  ) : env.upgradeUrl ? (
                    <a
                      className="about-sheet__upgrade-btn"
                      href={env.upgradeUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Upgrade to Plus
                    </a>
                  ) : (
                    <span className="about-sheet__upgrade-muted">Upgrade link not set.</span>
                  )}
                </>
              )}
              {iap.ready && (
                /* App Store Review Guideline 3.1.1 — auto-renewable subscriptions must
                 * include a Restore Purchases button. Always shown when IAP is wired,
                 * including for users who already have Plus active (handles "I bought on
                 * my other iPhone" / "I deleted and reinstalled" cases). */
                <button
                  type="button"
                  className="about-sheet__upgrade-link"
                  onClick={() => void iap.restore()}
                  disabled={iap.busy}
                >
                  {iap.busy ? "Restoring…" : "Restore purchases"}
                </button>
              )}
              {env.manageSubscriptionUrl ? (
                <a
                  className="about-sheet__upgrade-link"
                  href={env.manageSubscriptionUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Manage subscription
                </a>
              ) : (
                <span className="about-sheet__upgrade-muted">Manage-subscription link not set.</span>
              )}
            </div>
            {iap.message && (
              <p
                className={
                  iap.messageKind === "success"
                    ? "about-sheet__upgrade-success"
                    : "about-sheet__upgrade-muted"
                }
                role={iap.messageKind === "error" ? "alert" : "status"}
              >
                {iap.message}
              </p>
            )}
          </section>

          {!plus && (
            <details className="about-sheet__panel about-sheet__panel--subscription about-sheet__details">
              <summary>What Plus adds</summary>
              <ul className="about-sheet__bullets" aria-label="Plus features">
                <li>
                  <strong>NWS</strong> — full storm map, every active warning, route overlap, and hazard details (Plus
                  only; Basic is navigation, radar, and limited saved places/routes)
                </li>
                <li>
                  <strong>Traffic</strong> overlay + bypass tools (Mapbox)
                </li>
                <li>
                  <strong>Weather</strong> — local forecast at your position, route hints (OpenWeather), and minute
                  precip (Tomorrow.io)
                </li>
                <li>
                  <strong>Auto reroute</strong> when far off-line (optional)
                </li>
                <li>
                  <strong>Patterns</strong> — preferred A/B/C per area + frequent-route learning
                </li>
              </ul>
              <p className="about-sheet__p">Plus toggles live in Settings below.</p>
            </details>
          )}

          <section className="about-sheet__panel about-sheet__panel--settings">
            <h3 className="about-sheet__h3">Settings</h3>
            <div className="about-sheet__settings">
            <label className="about-sheet__setting">
              <input
                type="checkbox"
                checked={settings.radarEnabled}
                onChange={(e) => onSettings({ ...settings, radarEnabled: e.target.checked })}
              />
              <span>
                <strong>Radar</strong> (RainViewer) — enable the Rad button
              </span>
            </label>

            <label className={`about-sheet__setting${plus ? "" : " disabled"}`}>
              <input
                type="checkbox"
                checked={settings.stormEnabled}
                disabled={!plus}
                onChange={(e) => onSettings({ ...settings, stormEnabled: e.target.checked })}
              />
              <span>
                {plus ? (
                  <>
                    <strong>Advisory bar</strong> (NWS) — warning map, route overlap, and hazard details when NWS session
                    tools are on
                  </>
                ) : (
                  <>
                    <strong>Status strip</strong> — tips and offers on Basic. Local forecast, NWS hazards, and map
                    polygons are <em>Plus</em> only.
                  </>
                )}
              </span>
            </label>

            <label className={`about-sheet__setting${plus ? "" : " disabled"}`}>
              <input
                type="checkbox"
                checked={settings.trafficEnabled}
                disabled={!plus}
                onChange={(e) => onSettings({ ...settings, trafficEnabled: e.target.checked })}
              />
              <span>
                <strong>Traffic overlay</strong> (Mapbox) — fetch traffic along routes{" "}
                {!plus ? <em>(Plus)</em> : null}
              </span>
            </label>

            <label className={`about-sheet__setting${plus ? "" : " disabled"}`}>
              <input
                type="checkbox"
                checked={settings.weatherHintsEnabled}
                disabled={!plus}
                onChange={(e) => onSettings({ ...settings, weatherHintsEnabled: e.target.checked })}
              />
              <span>
                <strong>Weather hints</strong> (OpenWeather) — sample conditions along routes{" "}
                {!plus ? <em>(Plus)</em> : null}
              </span>
            </label>

            <label className="about-sheet__setting">
              <input
                type="checkbox"
                checked={settings.dataSaverEnabled}
                onChange={(e) => onSettings({ ...settings, dataSaverEnabled: e.target.checked })}
              />
              <span>
                <strong>Data saver</strong> — slower NWS/traffic refresh, one route leg at a time while
                planning, static radar (no animation), and Tomorrow.io only when the advisory or corridor
                forecast is open. Good for long drives on cellular data. Also follows your phone&apos;s
                &quot;use less data&quot; when set.
              </span>
            </label>

            <label className={`about-sheet__setting${plus ? "" : " disabled"}`}>
              <input
                type="checkbox"
                checked={settings.autoRerouteEnabled}
                disabled={!plus}
                onChange={(e) => onSettings({ ...settings, autoRerouteEnabled: e.target.checked })}
              />
              <span>
                <strong>Auto reroute</strong> — when you leave the route or turn onto a different road,
                fetch a new line from your GPS (no need to tap Re-route). Basic shows an{" "}
                <strong>Off route</strong> / <strong>Re-route</strong> button
                instead {!plus ? <em>(Plus)</em> : null}
              </span>
            </label>

            <label className="about-sheet__setting">
              <input
                type="checkbox"
                checked={settings.voiceGuidanceEnabled}
                onChange={(e) => onSettings({ ...settings, voiceGuidanceEnabled: e.target.checked })}
              />
              <span>
                <strong>Voice prompts</strong> — speak the next maneuver while <strong>Go</strong> navigation is on
                (any view; device text-to-speech). Use a passenger or pull over to change settings.
              </span>
            </label>

            <label className="about-sheet__setting">
              <input
                type="checkbox"
                checked={settings.gpsHighRefreshEnabled}
                onChange={(e) => onSettings({ ...settings, gpsHighRefreshEnabled: e.target.checked })}
              />
              <span>
                <strong>GPS high refresh</strong> — request fresher positions (uses more battery). Turn off if the
                puck feels jittery.
              </span>
            </label>

            <fieldset className="about-sheet__home-framing">
              <legend className="about-sheet__home-framing-legend">Map follow (no active trip)</legend>
              <p className="about-sheet__p about-sheet__p--tight">
                Before you set a destination, choose whether the map stays locked on your GPS puck or
                lets you pan and zoom freely without the camera snapping back.
              </p>
              <label className="about-sheet__home-framing-option">
                <input
                  type="radio"
                  name="home-puck-follow"
                  checked={homePuckFollow === "follow"}
                  onChange={() => onHomePuckFollowChange("follow")}
                />
                <span>
                  <strong>Keep puck centered</strong> — while you drive, the map moves under you and your
                  location stays in the middle (tap <strong>My location</strong> anytime to re-center after
                  panning).
                </span>
              </label>
              <label className="about-sheet__home-framing-option">
                <input
                  type="radio"
                  name="home-puck-follow"
                  checked={homePuckFollow === "explore"}
                  onChange={() => onHomePuckFollowChange("explore")}
                />
                <span>
                  <strong>Explore the map</strong> — pan and zoom anywhere; your puck moves on the map but
                  won&apos;t pull the camera back until you tap <strong>My location</strong>.
                </span>
              </label>
            </fieldset>

            <div
              className="about-sheet__tier-preview about-sheet__panel about-sheet__panel--settings-inset"
              role="group"
              aria-label="Side view handedness"
            >
              <p className="about-sheet__tier-preview-label">Side view (landscape) — dominant hand</p>
              <div className="about-sheet__tier-preview-btns">
                <button
                  type="button"
                  className={`about-sheet__tier-preview-btn${settings.landscapeSideHand === "left" ? " about-sheet__tier-preview-btn--active" : ""}`}
                  onClick={() => onSettings({ ...settings, landscapeSideHand: "left" })}
                >
                  Left
                </button>
                <button
                  type="button"
                  className={`about-sheet__tier-preview-btn${settings.landscapeSideHand === "right" ? " about-sheet__tier-preview-btn--active" : ""}`}
                  onClick={() => onSettings({ ...settings, landscapeSideHand: "right" })}
                >
                  Right
                </button>
              </div>
              <p className="about-sheet__tier-preview-hint">
                Only applies in landscape. Portrait stays the same — use this when you mount the phone on your other
                side.
              </p>
            </div>
            </div>
          </section>

          <MapKeyPanel />

          {onReplayCoachmarks && (
            <section className="about-sheet__panel about-sheet__panel--help">
              <h3 className="about-sheet__h3">Help</h3>
              <p className="about-sheet__muted-line">
                Forgot what a button does? Re-arm the in-app tips and they'll explain each
                piece of UI again the first time you see it (advisory bar, view-cycle
                button, route progress bar, and the i info button).
              </p>
              <div className="about-sheet__help-actions">
                <button
                  type="button"
                  className="about-sheet__btn about-sheet__btn--ghost"
                  onClick={onReplayCoachmarks}
                >
                  Show tips again
                </button>
              </div>
            </section>
          )}

          {plus && activityTrail && (
            <section className="about-sheet__panel about-sheet__panel--activity">
              <h3 className="about-sheet__h3">Activity trail</h3>
              <label className="about-sheet__setting">
                <input
                  type="checkbox"
                  checked={activityTrail.learnEnabled}
                  onChange={(e) => activityTrail.onLearnEnabledChange(e.target.checked)}
                />
                <span>
                  <strong>Learn where I drive</strong> — save sparse GPS dots on this device so the map and search can
                  favor your area. Turn off any time; existing dots stay until you erase them.
                </span>
              </label>
              <p className="about-sheet__p">
                With this on, StormPath saves sparse GPS dots (about every minute while you move) to learn where
                you usually drive. That helps <strong>frame the map</strong> around your area,{" "}
                <strong>rank search suggestions</strong> nearer places you know,{" "}
                <strong>prefer familiar alternates</strong> when A/B/C routes are built, and show the cyan overlay below. Trip
                detection for “frequent routes” uses a separate path.
              </p>
              <details className="about-sheet__details about-sheet__details--inline">
                <summary>How it works</summary>
                <p className="about-sheet__p">
                  Dots accrue only with the app open; older points drop when storage is full (~22k). Frequent-route rows
                  in Saved still need similar drives at least twice.
                </p>
              </details>
              <dl className="about-sheet__meta">
                <div className="about-sheet__meta-row">
                  <dt>Dots saved</dt>
                  <dd>{activityTrail.count.toLocaleString()}</dd>
                </div>
                {activityTrail.spanDays != null && (
                  <div className="about-sheet__meta-row">
                    <dt>Span</dt>
                    <dd>~{activityTrail.spanDays.toFixed(0)} days</dd>
                  </div>
                )}
                <div className="about-sheet__meta-row">
                  <dt>Range</dt>
                  <dd>
                    {activityTrail.oldestLabel} → {activityTrail.newestLabel}
                  </dd>
                </div>
              </dl>
              <label className="about-sheet__setting">
                <input
                  type="checkbox"
                  checked={activityTrail.showOnMap}
                  onChange={(e) => activityTrail.onShowOnMapChange(e.target.checked)}
                />
                <span>
                  <strong>Show activity dots on map</strong> — cyan trail of where you’ve been (zoom in to see density)
                </span>
              </label>
              <fieldset className="about-sheet__home-framing">
                <legend className="about-sheet__home-framing-legend">Home map view (no active trip)</legend>
                <p className="about-sheet__p about-sheet__p--tight">
                  When you open StormPath or finish a trip, the map centers like{" "}
                  <strong>My location</strong> or frames your <strong>usual driving area</strong> when enough trail dots
                  exist.
                </p>
                <label className="about-sheet__home-framing-option">
                  <input
                    type="radio"
                    name="home-map-framing"
                    checked={activityTrail.homeMapFraming === "auto"}
                    onChange={() => activityTrail.onHomeMapFramingChange("auto")}
                  />
                  <span>
                    <strong>Auto</strong> — usual area when the trail has enough dots ({activityTrail.homeAreaAvailable ? "available now" : "not enough yet"}), otherwise My location
                  </span>
                </label>
                <label className="about-sheet__home-framing-option">
                  <input
                    type="radio"
                    name="home-map-framing"
                    checked={activityTrail.homeMapFraming === "my_location"}
                    onChange={() => activityTrail.onHomeMapFramingChange("my_location")}
                  />
                  <span>
                    <strong>My location</strong> — street-level on your GPS (same as the My location button)
                  </span>
                </label>
                <label className={`about-sheet__home-framing-option${activityTrail.homeAreaAvailable ? "" : " disabled"}`}>
                  <input
                    type="radio"
                    name="home-map-framing"
                    checked={activityTrail.homeMapFraming === "activity_area"}
                    disabled={!activityTrail.homeAreaAvailable}
                    onChange={() => activityTrail.onHomeMapFramingChange("activity_area")}
                  />
                  <span>
                    <strong>My usual area</strong> — zoom to where your trail shows you usually drive
                    {!activityTrail.homeAreaAvailable ? " (need more dots)" : null}
                  </span>
                </label>
              </fieldset>
              <label
                className={`about-sheet__setting${activityTrail.homePreloadAvailable ? "" : " disabled"}`}
              >
                <input
                  type="checkbox"
                  checked={activityTrail.homePreloadEnabled}
                  disabled={!activityTrail.homePreloadAvailable}
                  onChange={(e) => activityTrail.onHomePreloadEnabledChange(e.target.checked)}
                />
                <span>
                  <strong>Preload my usual area (Wi‑Fi only)</strong> — after enough trail dots, quietly
                  cache map tiles around where you usually drive so the map fills in faster on weak signal.
                  {activityTrail.homePreloadSizeLabel ? (
                    <> Estimated cache: {activityTrail.homePreloadSizeLabel}.</>
                  ) : (
                    <> Need more dots first.</>
                  )}
                </span>
              </label>
              <div className="about-sheet__trail-clear">
                {activityTrailClearStep === "idle" ? (
                  <button
                    type="button"
                    className="about-sheet__trail-clear-btn"
                    onClick={() => {
                      setActivityTrailClearAck(false);
                      setActivityTrailClearStep("confirm");
                    }}
                  >
                    Erase activity trail…
                  </button>
                ) : (
                  <div className="about-sheet__trail-clear-panel" role="alertdialog" aria-labelledby="trail-clear-title">
                    <p id="trail-clear-title" className="about-sheet__trail-clear-title">
                      Erase all activity trail data?
                    </p>
                    <p className="about-sheet__trail-clear-text">
                      This permanently deletes every saved GPS dot on this device. You will lose home map framing,
                      search ranking for your area, familiar route suggestions, and Wi‑Fi map preload for your usual
                      territory. StormPath will behave like a fresh install until new dots accumulate.
                    </p>
                    <label className="about-sheet__trail-clear-ack">
                      <input
                        type="checkbox"
                        checked={activityTrailClearAck}
                        onChange={(e) => setActivityTrailClearAck(e.target.checked)}
                      />
                      <span>I understand this cannot be undone</span>
                    </label>
                    <div className="about-sheet__trail-clear-row">
                      <button
                        type="button"
                        className="about-sheet__trail-clear-cancel"
                        onClick={() => {
                          setActivityTrailClearStep("idle");
                          setActivityTrailClearAck(false);
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="about-sheet__trail-clear-confirm-btn"
                        disabled={!activityTrailClearAck}
                        onClick={() => {
                          activityTrail.onClear();
                          setActivityTrailClearStep("idle");
                          setActivityTrailClearAck(false);
                        }}
                      >
                        Erase trail data
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          <details className="about-sheet__panel about-sheet__details">
            <summary>When data looks wrong</summary>
            <p className="about-sheet__p">
              StormPath stitches together your phone, your network, and several live data providers. If one link is
              weak, the rest of the app can still work — so a blank radar layer does not always mean routing failed, and
              a working map does not guarantee every forecast loaded.
            </p>
            <p className="about-sheet__p">
              <strong>Usually not the app alone:</strong>
            </p>
            <ul className="about-sheet__bullets">
              <li>
                <strong>No or poor connection</strong> — map tiles, radar, alerts, traffic, and forecasts need cellular
                or Wi‑Fi. Offline mode keeps your last route; live layers pause until you reconnect.
              </li>
              <li>
                <strong>Provider delay or outage</strong> — Mapbox, NWS, RainViewer, OpenWeather, or Tomorrow.io can be
                slow, rate-limited, or down. We show a short note in the advisory bar when we know which feed failed.
              </li>
              <li>
                <strong>Phone / GPS</strong> — location permission, low power mode, or weak GPS can delay the puck,
                reroute, or “at your location” forecasts.
              </li>
              <li>
                <strong>Your settings</strong> — Radar, storm/NWS, traffic, and road overlays can be off in About or the
                hazard toggles. <strong>Drive</strong> view hides the radar overlay by design.
              </li>
              <li>
                <strong>Region or build</strong> — NWS polygons are US-focused. Some builds ship without every API key;
                Support diagnostics shows which providers are on for this install.
              </li>
            </ul>
            <p className="about-sheet__p">
              <strong>What to try:</strong> reconnect, wait a minute and open the advisory bar again, confirm toggles
              and <strong>Rad</strong> in Route/Map view, then copy <strong>Support diagnostics</strong> below if you
              email us — that shows online status and which providers this build has, not your personal data.
            </p>
          </details>

          <details className="about-sheet__panel about-sheet__panel--privacy about-sheet__details">
            <summary>Privacy, safety &amp; data</summary>
            <p className="about-sheet__p">
              <strong>Data:</strong> Map, routing, and traffic use <strong>Mapbox</strong> when configured; live radar
              mosaic uses <strong>RainViewer</strong>; US warning shapes use <strong>NWS</strong> (api.weather.gov);
              route weather samples use <strong>OpenWeather</strong> when enabled in Settings; minute-by-minute precip
              and hourly outlook at your location use <strong>Tomorrow.io</strong> when this build includes the API key
              (no separate off switch).
            </p>
            <p className="about-sheet__p">
              <strong>Forecasts in the app:</strong> expand the storm advisory bar for local weather at your position;
              route hazards and timeline details stay in the advisory sections. Map <strong>Rad</strong> is RainViewer;
              colored NWS shapes follow the <strong>NWS polygons</strong> toggle.
            </p>
            <p className="about-sheet__p">
              <strong>Privacy:</strong> Location is for position, routing, and conditions while you use the app. Plus
              frequent-route data stays on this device unless you sync later.
            </p>
            <p className="about-sheet__p">
              <strong>Safety:</strong> Follow posted signs and warnings. StormPath may be incomplete — don’t use the app
              while driving; use a passenger or pull over.
            </p>
            <p className="about-sheet__p">
              <a
                href={env.privacyPolicyUrl || "/privacy.html"}
                target="_blank"
                rel="noreferrer"
              >
                Privacy Policy
              </a>
              {" · "}
              <a
                href={env.termsUrl || "/terms.html"}
                target="_blank"
                rel="noreferrer"
              >
                Terms
              </a>
              {" · "}
              {env.supportUrl ? (
                <a href={env.supportUrl} target="_blank" rel="noreferrer">
                  Support
                </a>
              ) : env.supportEmail ? (
                <a href={`mailto:${env.supportEmail}`}>Email support</a>
              ) : (
                <>Support not set</>
              )}
            </p>
          </details>

          <section className="about-sheet__panel about-sheet__panel--support">
            <h3 className="about-sheet__h3">Support diagnostics</h3>
            <p className="about-sheet__p">
              Send bug reports, suggestions, feature requests, or general feedback. Include diagnostics (no personal
              info — version, toggles, and which data providers are configured) so we can tell an app bug from a network
              or provider issue faster.
            </p>
            <label className="about-sheet__setting about-sheet__setting--stack">
              <span>
                <strong>Your message</strong> (problem report, suggestion/request, or how StormPath is doing)
              </span>
              <textarea
                className="about-sheet__support-note"
                value={supportNote}
                onChange={(e) => setSupportNote(e.target.value)}
                rows={4}
                placeholder="Example: Route rerouted into a closed road near downtown around 6:40 PM; also requesting avoid unpaved roads."
              />
            </label>
            <div className="about-sheet__upgrade-actions">
              <button
                type="button"
                className="about-sheet__upgrade-link about-sheet__btn"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(diagnosticsText);
                  } catch {
                    // Fallback: prompt lets users copy manually.
                    window.prompt("Copy diagnostics", diagnosticsText);
                  }
                }}
              >
                Copy diagnostics
              </button>
              <button
                type="button"
                className="about-sheet__upgrade-link about-sheet__btn"
                disabled={!supportEmail}
                title={supportEmail ? `Email ${supportEmail}` : "Support email not configured"}
                onClick={() => {
                  if (!supportEmail) return;
                  const subject = encodeURIComponent(`StormPath support (${versionLabel})`);
                  const body = encodeURIComponent(
                    `${supportNote.trim() ? `Message:\n${supportNote.trim()}\n\n` : ""}Diagnostics:\n${diagnosticsText}`
                  );
                  window.location.href = `mailto:${supportEmail}?subject=${subject}&body=${body}`;
                }}
              >
                Email feedback with diagnostics
              </button>
            </div>
            <p className="about-sheet__p">
              {supportEmail ? (
                <>
                  Sends to <strong>{supportEmail}</strong> through your default email app.
                </>
              ) : (
                <>Support email not configured for this build.</>
              )}
            </p>
          </section>
        </div>

        <div className="about-sheet__actions">
          <button type="button" className="name-sheet-btn name-sheet-btn--primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </>
  );
}

/**
 * Build the "Subscribe — $4.99 / month" style label for the IAP button. RevenueCat's
 * `priceString` is locale-formatted by the App Store ($4.99, £4.99, €4,99) so we just
 * append a short period suffix derived from the package identifier. Falls back to plain
 * "Subscribe to Plus" if anything in the shape is unexpected.
 */
function formatSubscribeButtonLabel(pkg: PurchasesPackage): string {
  const price = pkg.product?.priceString;
  if (!price) return "Subscribe to Plus";
  /* RevenueCat "package types" map to canonical period strings. We surface only the four
   * we'd realistically configure; anything else we render as just the price. */
  const period = (() => {
    switch (pkg.packageType) {
      case "MONTHLY":
        return " / mo";
      case "ANNUAL":
        return " / yr";
      case "WEEKLY":
        return " / wk";
      case "LIFETIME":
        return " · lifetime";
      default:
        return "";
    }
  })();
  return `Subscribe — ${price}${period}`;
}
