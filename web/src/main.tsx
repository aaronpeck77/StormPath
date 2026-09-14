import { Component, StrictMode, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { initRevenueCat } from "./billing/revenueCat";
import { stormpathFlavorGuardString } from "./config/buildFlavor";
import { getWebEnv } from "./config/env";
import "./index.css";
import { captureAppException, initCrashReporting, installGlobalErrorHandlers } from "./monitoring/sentry";
import { startMapboxUsageMeter } from "./monitoring/mapboxUsageMeter";
import { hydrateSafeStorage } from "./storage/safeStorage";
import { clearActiveTripCache } from "./tripCache";

initCrashReporting();
installGlobalErrorHandlers();
void stormpathFlavorGuardString();

const EB_RELOAD_AT_KEY = "sp_error_boundary_reload_at";
const EB_RELOAD_LOOP_MS = 4_000;

/** Wipe trip cache and reload home. Returns false if a reload just failed (loop guard). */
function tryScheduleHomeReload(): boolean {
  try {
    const prev = Number(sessionStorage.getItem(EB_RELOAD_AT_KEY) || "0");
    const now = Date.now();
    if (Number.isFinite(prev) && prev > 0 && now - prev < EB_RELOAD_LOOP_MS) {
      return false;
    }
    sessionStorage.setItem(EB_RELOAD_AT_KEY, String(now));
  } catch {
    /* private mode / storage blocked — still try reload once */
  }
  void clearActiveTripCache()
    .catch(() => undefined)
    .finally(() => {
      window.location.reload();
    });
  return true;
}

class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null; reloading: boolean }
> {
  state: { error: Error | null; reloading: boolean } = { error: null, reloading: false };

  static getDerivedStateFromError(error: Error) {
    return { error, reloading: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("StormPath crash:", error, info.componentStack);
    captureAppException(error, {
      componentStack: info.componentStack,
      source: "react_error_boundary",
    });
    if (!tryScheduleHomeReload()) {
      this.setState({ reloading: false });
    }
  }

  render() {
    if (this.state.error) {
      /* Stop / mid-trip throws: blank flash → clear trip cache → home. No Reload tap. */
      if (this.state.reloading) {
        return (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "#0a0b0d",
            }}
            aria-hidden
          />
        );
      }

      return (
        <div
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "#0a0b0d",
            color: "#e2e8f0",
            fontFamily: "system-ui, sans-serif",
            padding: "24px",
            textAlign: "center",
          }}
        >
          <h1 style={{ fontSize: "1.4rem", margin: "0 0 12px" }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: "0.9rem", color: "#94a3b8", margin: "0 0 12px", maxWidth: "320px" }}>
            StormPath hit an unexpected error. Tap below to reload. If this keeps happening, use About →
            Support diagnostics to send feedback.
          </p>
          {this.state.error.message ? (
            <p
              style={{
                fontSize: "0.75rem",
                color: "#64748b",
                margin: "0 0 20px",
                maxWidth: "340px",
                wordBreak: "break-word",
                fontFamily: "ui-monospace, monospace",
              }}
            >
              {this.state.error.message}
            </p>
          ) : null}
          <button
            onClick={() => window.location.reload()}
            style={{
              appearance: "none",
              padding: "12px 28px",
              borderRadius: "12px",
              border: "1px solid rgba(251,191,36,0.45)",
              background: "rgba(251,191,36,0.15)",
              color: "#fcd34d",
              fontSize: "1rem",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/* Block first render until persisted settings/saved-data are in the in-memory cache so
 * `useState(() => readSetting())` initializers and other sync reads see real values. */
hydrateSafeStorage().finally(() => {
  /* Fire-and-forget RevenueCat init. Doesn't block first paint — the SDK takes ~100-300 ms
   * on cold start and the AboutSheet (where its UI lives) is several taps deep. If the user
   * opens AboutSheet before init resolves, `isRevenueCatReady()` returns false and the panel
   * shows the legacy URL fallback; once configure resolves, the customer-info listener fires
   * and the next AboutSheet open reflects entitlement state correctly. No-op on web /
   * unconfigured (missing API key). */
  void initRevenueCat({ iosApiKey: getWebEnv().revenueCatApiKeyIos });
  startMapboxUsageMeter();

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>
  );

  /* After a healthy boot, allow a future Stop throw to auto-reload again. */
  window.setTimeout(() => {
    try {
      sessionStorage.removeItem(EB_RELOAD_AT_KEY);
    } catch {
      /* ignore */
    }
  }, EB_RELOAD_LOOP_MS + 1_000);
});
