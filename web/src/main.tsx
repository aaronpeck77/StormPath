import { Component, StrictMode, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

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
            StormPath hit an unexpected error. Tap below to reload.
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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
