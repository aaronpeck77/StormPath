/** Cooldown between recoveries of the same watch — see FIELD_RESILIENCE_SUPERVISOR.md. */
export const SUPERVISOR_REPAIR_COOLDOWN_MS = 60_000;

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
