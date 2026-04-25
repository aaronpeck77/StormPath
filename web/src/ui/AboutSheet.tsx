import { useEffect, useMemo, useState } from "react";
import { getPayTier, type PayTier } from "../billing/payFeatures";
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
  /** Preview Basic vs Plus UI (does not change subscription; persists until My plan). */
  payTierPreview: PayTier | null;
  onPayTierPreviewChange: (tier: PayTier | null) => void;
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
  payTierPreview,
  onPayTierPreviewChange,
  activityTrail = null,
  settings,
  onSettings,
}: Props) {
  const subscribedTier = useMemo(() => getPayTier(), [open, payTierPreview]);
  const dev = import.meta.env.DEV;
  /** Temporary tester override so Basic/Plus can be validated in TestFlight before paywall wiring. */
  const effectiveTier = payTierPreview ?? subscribedTier;
  const tierLabel = effectiveTier === "plus" ? "Plus" : "Basic";
  const plus = effectiveTier === "plus";
  const subscribedLabel = subscribedTier === "plus" ? "Plus" : "Basic";
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

  if (!open) return null;

  const diagnosticsLines = [
    `StormPath ${__APP_VERSION__}${dev ? " (dev)" : ""}`,
    `Plan: ${tierLabel}${payTierPreview != null ? " (preview)" : ""}`,
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
            <dd title="From package.json at build time">
              {__APP_VERSION__}
              {dev ? " (development)" : ""}
            </dd>
          </div>
          <div className="about-sheet__meta-row">
            <dt>Plan</dt>
            <dd>
              {tierLabel}
              {dev && payTierPreview != null && (
                <span className="about-sheet__preview-badge" title="Preview only — not your subscription">
                  {" "}
                  (preview)
                </span>
              )}
            </dd>
          </div>
          <div className="about-sheet__meta-row">
            <dt>Subscribed</dt>
            <dd>{subscribedLabel}</dd>
          </div>
        </dl>

        {
          <div className="about-sheet__tier-preview about-sheet__panel" role="group" aria-label="Preview app tier">
            <p className="about-sheet__tier-preview-label">Testing tier override</p>
            <div className="about-sheet__tier-preview-btns">
              <button
                type="button"
                className={`about-sheet__tier-preview-btn${payTierPreview === null ? " about-sheet__tier-preview-btn--active" : ""}`}
                onClick={() => onPayTierPreviewChange(null)}
              >
                My plan
              </button>
              <button
                type="button"
                className={`about-sheet__tier-preview-btn${payTierPreview === "free" ? " about-sheet__tier-preview-btn--active" : ""}`}
                onClick={() => onPayTierPreviewChange("free")}
              >
                Basic
              </button>
              <button
                type="button"
                className={`about-sheet__tier-preview-btn${payTierPreview === "plus" ? " about-sheet__tier-preview-btn--active" : ""}`}
                onClick={() => onPayTierPreviewChange("plus")}
              >
                Plus
              </button>
            </div>
            <p className="about-sheet__tier-preview-hint">
              Temporary testing control — tap <strong>My plan</strong> to reset. Subscribed above is your real tier.
            </p>
          </div>
        }

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
                Sparse GPS dots (≈every few min while moving) when <strong>Learn repeated trips</strong> is on — map
                overlay in About. Separate from commute polyline detection.
              </p>
              <details className="about-sheet__details about-sheet__details--inline">
                <summary>How it works</summary>
                <p className="about-sheet__p">
                  Saved ★ → Frequent routes must have learning enabled. Dots accrue only with the app open; older points
                  drop when storage is full (~22k).
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
                  <strong>Show dots on map</strong> (cyan, zoom in to see density)
                </span>
              </label>
              <div className="about-sheet__upgrade-actions">
                <button type="button" className="about-sheet__upgrade-link" onClick={() => activityTrail.onClear()}>
                  Clear all trail data on this device
                </button>
              </div>
            </section>
          )}

          {!plus && (
            <details className="about-sheet__panel about-sheet__details">
              <summary>What Plus adds</summary>
              <ul className="about-sheet__bullets" aria-label="Plus features">
                <li>
                  <strong>NWS</strong> storm polygons, route overlap, hazard details
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

            <label className={`about-sheet__setting${plus ? "" : " disabled"}`}>
              <input
                type="checkbox"
                checked={plus ? settings.stormEnabled : false}
                disabled={!plus}
                onChange={(e) => onSettings({ ...settings, stormEnabled: e.target.checked })}
              />
              <span>
                <strong>Storm polygons</strong> (NWS) — map overlap + route highlights while navigating{" "}
                {!plus ? <em>(Plus)</em> : null}
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
                <strong>Voice prompts</strong> — speak the next maneuver in <strong>Dr</strong> mode (device
                text-to-speech). Use a passenger or pull over to change settings.
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
              If you contact support, include diagnostics (no personal info, just app configuration).
            </p>
            <label className="about-sheet__setting about-sheet__setting--stack">
              <span>
                <strong>Your message</strong> (what happened, expected result, route/location context)
              </span>
              <textarea
                className="about-sheet__support-note"
                value={supportNote}
                onChange={(e) => setSupportNote(e.target.value)}
                rows={4}
                placeholder="Example: Route rerouted into closed road near downtown around 6:40 PM."
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
                title={supportEmail ? `Email ${supportEmail}` : "Set VITE_SUPPORT_EMAIL to enable"}
                onClick={() => {
                  if (!supportEmail) return;
                  const subject = encodeURIComponent(`StormPath support (${__APP_VERSION__})`);
                  const body = encodeURIComponent(
                    `${supportNote.trim() ? `Message:\n${supportNote.trim()}\n\n` : ""}Diagnostics:\n${diagnosticsText}`
                  );
                  window.location.href = `mailto:${supportEmail}?subject=${subject}&body=${body}`;
                }}
              >
                Email support with diagnostics
              </button>
            </div>
            <p className="about-sheet__p">
              {supportEmail ? (
                <>
                  Sends to <strong>{supportEmail}</strong> through your default email app.
                </>
              ) : (
                <>Support email not set (add VITE_SUPPORT_EMAIL).</>
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
