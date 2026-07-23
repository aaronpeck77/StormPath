/**
 * Client-side log for "Jeff the Fix-It Bot".
 *
 * Persists a local rolling log of every watchdog auto-fix / manual fix tap (see
 * `useDriveCameraHealth`, `useLiveTrafficHealth`, `JeffBadge`), and reports each one to
 * `ops-jeff` so the Control Room can show what Jeff has caught — and when — across devices.
 * Mirrors `mapboxUsageMeter.ts`: same device-id / pending-queue / flush-on-a-timer shape.
 */

import { safeStorage } from "../storage/safeStorage";
import { getWebEnv } from "../config/env";
import type { JeffSighting } from "../ui/jeffTheBot";

const LOCAL_LOG_KEY = "stormpath.jeff.localLog.v1";
const PENDING_KEY = "stormpath.jeff.pending.v1";
const DEVICE_KEY = "stormpath.jeff.deviceId.v1";
/** Keep this device's own visible history short — the Control Room's real value is the
 *  cross-device server log; this is just a same-device fallback / sanity check. */
const MAX_LOCAL_LOG = 120;
const FLUSH_MS = 15_000;

export type LoggedJeffFix = {
  atMs: number;
  domain: JeffSighting["domain"];
  manual: boolean;
  note: string;
};

let pending: LoggedJeffFix[] = [];
let flushTimer: number | null = null;
let flushInFlight = false;
let started = false;

function deviceId(): string {
  let id = safeStorage.get(DEVICE_KEY);
  if (id && id.length >= 8) return id;
  id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  safeStorage.set(DEVICE_KEY, id);
  return id;
}

function loadPending(): LoggedJeffFix[] {
  return safeStorage.getJson<LoggedJeffFix[]>(PENDING_KEY, []);
}

function savePending(list: LoggedJeffFix[]): void {
  safeStorage.setJson(PENDING_KEY, list.slice(-200));
}

/** This device's own recent fix history, newest last — same-device fallback for the Control
 *  Room when the live `ops-jeff` summary isn't reachable (e.g. testing without a hub secret). */
export function readLocalJeffFixLog(): LoggedJeffFix[] {
  return safeStorage.getJson<LoggedJeffFix[]>(LOCAL_LOG_KEY, []);
}

function addLocalLog(entry: LoggedJeffFix): void {
  const list = readLocalJeffFixLog();
  list.push(entry);
  while (list.length > MAX_LOCAL_LOG) list.shift();
  safeStorage.setJson(LOCAL_LOG_KEY, list);
}

function opsJeffEndpoints(): string[] {
  const env = getWebEnv();
  const custom = (import.meta.env.VITE_OPS_USAGE_URL as string | undefined)?.trim();
  const out: string[] = [];
  if (custom) {
    out.push(`${custom.replace(/\/$/, "").replace(/\/ops-usage$/, "")}/ops-jeff`);
  }
  if (typeof window !== "undefined" && window.location.origin.startsWith("http")) {
    out.push(`${window.location.origin}/ops-jeff`);
    out.push(`${window.location.origin}/.netlify/functions/ops-jeff`);
  }
  const wk = env.weatherKitTokenUrl || "";
  try {
    const u = new URL(wk);
    out.push(`${u.origin}/.netlify/functions/ops-jeff`);
    out.push(`${u.origin}/ops-jeff`);
  } catch {
    /* ignore */
  }
  return [...new Set(out)];
}

function ingestToken(): string {
  return (import.meta.env.VITE_OPS_USAGE_INGEST_TOKEN as string | undefined)?.trim() || "";
}

function scheduleFlush(): void {
  if (typeof window === "undefined") return;
  if (flushTimer != null) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    void flushJeffFixLog();
  }, FLUSH_MS);
}

/** Record one Jeff fix (watchdog auto-repair or manual tap). Called from `reportJeffSighting`
 *  so every sighting — however it was triggered — is logged the same way. */
export function recordJeffFix(sighting: JeffSighting): void {
  const entry: LoggedJeffFix = {
    atMs: sighting.atMs,
    domain: sighting.domain,
    manual: Boolean(sighting.manual),
    note: sighting.note,
  };
  addLocalLog(entry);
  pending = [...loadPending(), entry];
  savePending(pending);
  scheduleFlush();
}

/** Push pending fix events to ops-jeff (no-op when nothing pending or no ingest token). */
export async function flushJeffFixLog(): Promise<void> {
  if (flushInFlight) return;
  const queue = loadPending();
  if (!queue.length) return;
  const token = ingestToken();
  if (!token) return;

  flushInFlight = true;
  try {
    const body = JSON.stringify({ deviceId: deviceId(), events: queue });
    let ok = false;
    for (const url of opsJeffEndpoints()) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body,
          cache: "no-store",
        });
        if (res.ok) {
          ok = true;
          break;
        }
        if (res.status !== 404) break;
      } catch {
        /* try next */
      }
    }
    if (ok) {
      pending = [];
      savePending(pending);
    } else if (import.meta.env.DEV) {
      console.info("[jeff-fix-log] ingest unavailable — will retry; local log still updated");
    }
  } finally {
    flushInFlight = false;
  }
}

/** Call once from app boot so pending fix events flush on a timer + when backgrounding. */
export function startJeffFixLogFlusher(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  pending = loadPending();
  if (pending.length) scheduleFlush();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushJeffFixLog();
  });
  window.addEventListener("pagehide", () => {
    void flushJeffFixLog();
  });
}
