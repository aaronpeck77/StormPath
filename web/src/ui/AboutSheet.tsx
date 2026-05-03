import { useEffect, useMemo, useState } from "react";
import { getPayTier, PAY_TIER_OVERRIDE_LS_KEY } from "../billing/payFeatures";
import { getWebEnv } from "../config/env";

type ActivityTrailPanel = {
  count: number;
  spanDays: number | null;
  oldestLabel: string;
  newestLabel: string;
  showOnMap: boolean;
  onShowOnMapChange: (on: boolean) => void;
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
  settings: {
    radarEnabled: boolean;
    stormEnabled: boolean;
    trafficEnabled: boolean;
    weatherHintsEnabled: boolean;
    autoRerouteEnabled: boolean;
    voiceGuidanceEnabled: boolean;
    gpsHighRefreshEnabled: boolean;
    /** Landscape / side view only — portrait layout ignores this */
    landscapeSideHand: "right" | "left";
  };
  onSettings: (next: Props["settings"]) => void;
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
  settings,
  onSettings,
}: Props) {
  const dev = import.meta.env.DEV;
  /** Same tier source as the rest of the app (`getPayTier` — build env + optional LS override). */
  const tier = useMemo(() => getPayTier(), [open, payTierProbeKey]);
  const tierLabel = tier === "plus" ? "Plus" : "Basic";
  const plus = tier === "plus";
  /** LS override for button highlight (same key as {@link getPayTier}). */
  const payTierOverrideMode = useMemo((): "none" | "free" | "plus" => {
    if (!onPayTierOverride) return "none";
    try {
      const v = localStorage.getItem(PAY_TIER_OVERRIDE_LS_KEY)?.toLowerCase();
      if (v === "free") return "free";
      if (v === "plus" || v === "pro") return "plus";
    } catch {
      /* ignore */
    }
    return "none";
  }, [onPayTierOverride, open, payTierProbeKey]);
  const env = useMemo(() => getWebEnv(), []);
  const [supportNote, setSupportNote] = useState("");

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
  useEffect(() => {
    if (!open) setActivityTrailClearStep("idle");
  }, [open]);

  if (!open) return null;

  const diagnosticsLines = [
    `StormPath ${__APP_VERSION__}${dev ? " (dev)" : ""}`,
    `Plan: ${tierLabel}`,
    `Online: ${typeof navigator === "undefined" ? "unknown" : navigator.onLine ? "yes" : "no"}`,
    `Voice: ${settings.voiceGuidanceEnabled ? "on" : "off"}, GPS refresh: ${
      settings.gpsHighRefreshEnabled ? "high" : "normal"
    }`,
    `Landscape UI: ${settings.landscapeSideHand === "left" ? "left hand" : "right hand"}`,
    `Providers: mapbox=${env.mapboxToken ? "on" : "off"}, openweather=${
      env.openWeatherApiKey ? "on" : "off"
    }`,
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
        <div className="about-sheet__panel about-sheet__panel--intro">
          <h2 id="about-sheet-title" className="about-sheet__title">
            StormPath
          </h2>
          <p className="about-sheet__tagline">Multi-route driving navigation and live conditions along your trip.</p>
        </div>

        <dl className="about-sheet__meta about-sheet__panel">
          <div className="about-sheet__meta-row">
            <dt>Version</dt>
            <dd title="From package.json at build time — bump web/package.json to confirm you’re on the latest bundle">
              {__APP_VERSION__}
              {dev ? " (development)" : ""}
            </dd>
          </div>
          <div className="about-sheet__meta-row">
            <dt>Plan</dt>
            <dd>{tierLabel}</dd>
          </div>
        </dl>

        {onPayTierOverride ? (
          <div
            className="about-sheet__tier-preview about-sheet__panel"
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
                  try {
                    localStorage.setItem(PAY_TIER_OVERRIDE_LS_KEY, "free");
                  } catch {
                    /* ignore */
                  }
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
                  try {
                    localStorage.setItem(PAY_TIER_OVERRIDE_LS_KEY, "plus");
                  } catch {
                    /* ignore */
                  }
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
                  try {
                    localStorage.removeItem(PAY_TIER_OVERRIDE_LS_KEY);
                  } catch {
                    /* ignore */
                  }
                  onPayTierOverride?.();
                }}
              >
                Build default
              </button>
            </div>
            <p className="about-sheet__tier-preview-hint">
              Sets <code className="saved-drawer-code">{PAY_TIER_OVERRIDE_LS_KEY}</code> (same as{" "}
              <code className="saved-drawer-code">getPayTier()</code>). Shipped on by default; before App Store / paywall,
              set build env <code className="saved-drawer-code">VITE_PAY_TIER_TEST_PANEL=false</code> to hide this
              block. <strong>Build default</strong> removes the override (dev → Plus unless{" "}
              <code className="saved-drawer-code">VITE_PAY_TIER</code> says otherwise).
            </p>
          </div>
        ) : null}

        <div className="about-sheet__scroll">
          <section className="about-sheet__panel">
            <h3 className="about-sheet__h3">Subscription</h3>
            <p className="about-sheet__p">
              You can manage or cancel anytime. Changes apply at the end of the billing period.
            </p>
            <div className="about-sheet__upgrade-actions">
              {!plus && (
                <>
                  {env.upgradeUrl ? (
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
          </section>

          {plus && activityTrail && (
            <section className="about-sheet__panel">
              <h3 className="about-sheet__h3">Activity trail</h3>
              <p className="about-sheet__p">
                With <strong>Learn repeated trips</strong> on, StormPath saves sparse GPS dots (about every few minutes
                while you move) to learn where you usually drive. That helps <strong>frame the map</strong> around your
                area, <strong>rank search suggestions</strong> nearer places you know, and show the cyan overlay below.
                Trip detection for “frequent routes” uses a separate path.
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
              <div className="about-sheet__trail-clear">
                {activityTrailClearStep === "idle" ? (
                  <button
                    type="button"
                    className="about-sheet__trail-clear-btn"
                    onClick={() => setActivityTrailClearStep("confirm")}
                  >
                    Clear all trail data on this device
                  </button>
                ) : (
                  <div className="about-sheet__trail-clear-panel" role="alert">
                    <p className="about-sheet__trail-clear-text">
                      Erase all saved GPS dots on this device? Map framing and search ranking that use your trail will
                      reset. This can’t be undone.
                    </p>
                    <div className="about-sheet__trail-clear-row">
                      <button
                        type="button"
                        className="about-sheet__trail-clear-cancel"
                        onClick={() => setActivityTrailClearStep("idle")}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="about-sheet__trail-clear-confirm-btn"
                        onClick={() => {
                          activityTrail.onClear();
                          setActivityTrailClearStep("idle");
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

          {!plus && (
            <details className="about-sheet__panel about-sheet__details">
              <summary>What Plus adds</summary>
              <ul className="about-sheet__bullets" aria-label="Plus features">
                <li>
                  <strong>NWS</strong> — full storm map, every active warning, route overlap, and hazard details (Plus
                  only; Basic uses navigation, radar, and the status strip — no in-app weather feeds)
                </li>
                <li>
                  <strong>Traffic</strong> overlay + bypass tools (Mapbox)
                </li>
                <li>
                  <strong>Weather</strong> hints on route (OpenWeather)
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

          <section className="about-sheet__panel">
            <h3 className="about-sheet__h3">Settings</h3>
            <div className="about-sheet__settings-scroll">
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

            <label className="about-sheet__setting">
              <input
                type="checkbox"
                checked={settings.stormEnabled}
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
                    <strong>Status strip</strong> — online/offline, tips, and Plus info. Basic does not load NWS or
                    forecast data; use the <strong>Rad</strong> control for radar on the map
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
                checked={settings.autoRerouteEnabled}
                onChange={(e) => onSettings({ ...settings, autoRerouteEnabled: e.target.checked })}
              />
              <span>
                <strong>Auto reroute</strong> — when far off the line, fetch a new route from your GPS (no
                need to tap Reroute). Uses your directions provider when online.
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

            <div className="about-sheet__tier-preview about-sheet__panel" role="group" aria-label="Side view handedness">
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
            </div>
          </section>

          <details className="about-sheet__panel about-sheet__details">
            <summary>Privacy, safety &amp; data</summary>
            <p className="about-sheet__p">
              <strong>Data:</strong> Map, routing, and traffic use Mapbox when configured; weather samples OpenWeather;
              US alerts via NWS (api.weather.gov). What runs depends on your keys and region.
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

          <section className="about-sheet__panel">
            <h3 className="about-sheet__h3">Support diagnostics</h3>
            <p className="about-sheet__p">
              Send bug reports, suggestions, feature requests, or general feedback. Include diagnostics (no personal
              info, just app configuration) so we can help faster.
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
                  const subject = encodeURIComponent(`StormPath support (${__APP_VERSION__})`);
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
