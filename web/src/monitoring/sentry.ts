import * as Sentry from "@sentry/react";
import { Capacitor } from "@capacitor/core";
import { stormpathSentryRelease } from "../appVersion";

let crashReportingActive = false;

/** True when `VITE_SENTRY_DSN` was set at build time and Sentry initialized. */
export function isCrashReportingEnabled(): boolean {
  return crashReportingActive;
}

/**
 * Optional crash reporting — no-op when `VITE_SENTRY_DSN` is unset (local dev without a project).
 * Call once before rendering React.
 */
export function initCrashReporting(): void {
  const dsn = (import.meta.env.VITE_SENTRY_DSN as string | undefined)?.trim();
  if (!dsn) {
    crashReportingActive = false;
    return;
  }

  const mode = import.meta.env.MODE;
  Sentry.init({
    dsn,
    environment: mode,
    release: stormpathSentryRelease(),
    enableLogs: false,
    /* Beta: capture every error; no performance tracing (smaller bundle, less noise). */
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    beforeSend(event) {
      /* Never attach free-text search or destination labels from breadcrumbs if added later. */
      return event;
    },
  });

  Sentry.setTag("platform", Capacitor.getPlatform());
  Sentry.setTag("build_mode", mode);
  const build = (import.meta.env.VITE_IOS_BUILD_NUMBER as string | undefined)?.trim();
  if (build) Sentry.setTag("ios_build", build);
  crashReportingActive = true;
}

export function captureAppException(
  error: unknown,
  context?: { componentStack?: string | null; source?: string }
): void {
  if (!crashReportingActive) return;
  Sentry.withScope((scope) => {
    if (context?.source) scope.setTag("error_source", context.source);
    if (context?.componentStack) {
      scope.setContext("react", { componentStack: context.componentStack });
    }
    Sentry.captureException(error);
  });
}
