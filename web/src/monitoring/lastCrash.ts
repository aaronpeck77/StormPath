import { safeStorage } from "../storage/safeStorage";

export type LastCrashRecord = {
  at: number;
  message: string;
  stack?: string;
  componentStack?: string;
  source: string;
};

const KEY = "stormpath.lastCrash.v1";
const STACK_CAP = 1_200;

/**
 * Persist the last serious crash so it survives the reload that follows it.
 * Sentry only fires when a DSN is configured; this record always exists and
 * shows up under About → Support diagnostics so a field report carries the
 * actual throw instead of "it flashed and went home."
 */
export function persistLastCrash(
  error: unknown,
  context?: { componentStack?: string | null; source?: string }
): void {
  try {
    const err = error instanceof Error ? error : null;
    const record: LastCrashRecord = {
      at: Date.now(),
      message: err ? err.message || err.name : String(error ?? "unknown"),
      ...(err?.stack ? { stack: err.stack.slice(0, STACK_CAP) } : {}),
      ...(context?.componentStack
        ? { componentStack: context.componentStack.slice(0, STACK_CAP) }
        : {}),
      source: context?.source ?? "unknown",
    };
    const json = JSON.stringify(record);
    /* Two stores: localStorage commits synchronously (survives the immediate
     * reload that follows a boundary crash — the native Preferences write is
     * fire-and-forget and can lose that race); safeStorage is the durable
     * canonical copy once its async write lands. */
    try {
      window.localStorage.setItem(KEY, json);
    } catch {
      /* quota / private mode — safeStorage copy may still land */
    }
    safeStorage.set(KEY, json);
  } catch {
    /* Never let crash reporting become the crash. */
  }
}

export function readLastCrash(): LastCrashRecord | null {
  let raw = safeStorage.getJson<unknown>(KEY, null);
  if (raw == null && typeof window !== "undefined") {
    try {
      const ls = window.localStorage.getItem(KEY);
      raw = ls ? (JSON.parse(ls) as unknown) : null;
    } catch {
      raw = null;
    }
  }
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<LastCrashRecord>;
  if (typeof r.at !== "number" || typeof r.message !== "string") return null;
  return r as LastCrashRecord;
}

export function clearLastCrash(): void {
  safeStorage.remove(KEY);
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Compact lines for the Support diagnostics copy block; [] when no record. */
export function lastCrashDiagnosticsLines(nowMs: number = Date.now()): string[] {
  const r = readLastCrash();
  if (!r) return [];
  const ageMin = Math.max(0, Math.round((nowMs - r.at) / 60_000));
  const age = ageMin < 1 ? "just now" : ageMin < 120 ? `${ageMin} min ago` : `${Math.round(ageMin / 60)} hr ago`;
  const lines = [`Last crash (${age}, ${r.source}): ${r.message.slice(0, 160)}`];
  const frame = (r.componentStack ?? r.stack ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("at Object.<anonymous>"))
    .slice(0, 3)
    .join(" | ");
  if (frame) lines.push(`  ↳ ${frame.slice(0, 220)}`);
  return lines;
}
