import * as Sentry from "@sentry/react";
import { isCrashReportingEnabled } from "./sentry";
import type { FieldSupervisorReport } from "./supervisorWatchList";

/** Where the watchdog fired — used as a Sentry tag for filtering. */
export type AppHealthDomain =
  | "nav_display"
  | "map_layers"
  | "route_ahead"
  | "trip_surface"
  | "drive_camera"
  | "drive_puck"
  | "live_traffic"
  | "supervisor";

const SIGNAL_COOLDOWN_MS = 5 * 60 * 1000;
const lastSentAt = new Map<string, number>();

/**
 * Report a non-fatal health anomaly to Sentry (when `VITE_SENTRY_DSN` is set).
 * Rate-limited per domain+code so repeated self-repair loops do not spam or cost quota.
 * No-op in local dev without DSN — zero runtime cost beyond the check.
 */
export function reportAppHealthSignal(
  domain: AppHealthDomain,
  code: string,
  detail?: Record<string, string | number | boolean>
): void {
  if (!isCrashReportingEnabled()) return;
  const key = `${domain}:${code}`;
  const now = Date.now();
  if (now - (lastSentAt.get(key) ?? 0) < SIGNAL_COOLDOWN_MS) return;
  lastSentAt.set(key, now);

  Sentry.withScope((scope) => {
    scope.setLevel("warning");
    scope.setTag("health_domain", domain);
    scope.setTag("health_code", code);
    if (detail) {
      for (const [k, v] of Object.entries(detail)) {
        scope.setExtra(k, v);
      }
    }
    Sentry.captureMessage(`stormpath.health.${domain}.${code}`, "warning");
  });
}

/** After an automatic repair, log what was wrong and what we tried. */
export function reportAppHealthRepair(
  domain: AppHealthDomain,
  issues: readonly string[],
  actions: readonly string[]
): void {
  if (!issues.length) return;
  reportAppHealthSignal(domain, issues[0] ?? "unknown", {
    issues: issues.join("|"),
    actions: actions.join("|"),
  });
}

/** Field supervisor event — message `stormpath.health.supervisor.{watchId}` for Automations. */
export function reportFieldSupervisorEvent(report: FieldSupervisorReport): void {
  reportAppHealthSignal("supervisor", report.watchId, {
    recovered: report.recovered,
    recovery: report.recovery,
    online: report.online,
    navigatorOnLine: report.navigatorOnLine,
    reachable: report.reachable == null ? "unknown" : report.reachable,
    screen: report.screen,
    stuckMs: report.stuckMs,
    field_report: JSON.stringify(report),
  });
}
