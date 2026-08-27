import type { SupervisorWatch } from "./supervisorWatchList";

/** Cooldown between recoveries of the same watch — see FIELD_RESILIENCE_SUPERVISOR.md. */
export const SUPERVISOR_REPAIR_COOLDOWN_MS = 60_000;
/** Re-entering a dead zone this soon after leaving one is a repeat, not a first sighting. */
export const SUPERVISOR_REPEAT_WINDOW_MS = 2 * 60_000;

export function canApplySupervisorRecovery(
  lastRecoveryAtMs: number | null,
  nowMs: number,
  cooldownMs = SUPERVISOR_REPAIR_COOLDOWN_MS
): boolean {
  if (lastRecoveryAtMs == null) return true;
  return nowMs - lastRecoveryAtMs >= cooldownMs;
}

export function supervisorStuckMs(startedAtMs: number, nowMs: number): number {
  return Math.max(0, nowMs - startedAtMs);
}

/** First dead-zone hold is silent (Sentry quota). A second one soon after is worth a report. */
export function shouldReportSupervisorWatch(
  reportWhen: SupervisorWatch["reportWhen"],
  isRepeat: boolean
): boolean {
  if (reportWhen === "always_after_recovery") return true;
  if (reportWhen === "if_repeated") return isRepeat;
  return false;
}
