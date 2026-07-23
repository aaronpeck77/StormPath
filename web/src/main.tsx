import { Component, StrictMode, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { initRevenueCat } from "./billing/revenueCat";
import { getWebEnv } from "./config/env";
import "./index.css";
import { captureAppException, initCrashReporting, installGlobalErrorHandlers } from "./monitoring/sentry";
import { startMapboxUsageMeter } from "./monitoring/mapboxUsageMeter";
import { hydrateSafeStorage } from "./storage/safeStorage";

initCrashReporting();
installGlobalErrorHandlers();

class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("StormPath crash:", error, info.componentStack);
    captureAppException(error, {
      componentStack: info.componentStack,
      source: "react_error_boundary",
    });
  }

  render() {
    if (this.state.error) {
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
          <p style={{ fontSize: "0.9rem", color: "#94a3b8", margin: "0 0 20px", maxWidth: "320px" }}>
            StormPath hit an unexpected error. Tap below to reload. If this keeps happening, use About →
            Support diagnostics to send feedback.
          </p>
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
});
