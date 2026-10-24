import { create } from "zustand";
import { safeStorage } from "../storage/safeStorage";

/**
 * Pending-route store (Zustand + safeStorage).
 *
 * Holds at most one queued request made while there was no usable data connection:
 * either a destination the driver tapped ("route") or a typed search ("search").
 * `usePendingRouteRetry` watches connectivity and replays the request once data
 * returns; the result lands in the normal route preview — it never auto-starts
 * navigation.
 *
 * **Persisted** (key `stormpath-pending-route-v1`) so a queued request survives an
 * app kill in a dead zone. Entries older than {@link PENDING_ROUTE_MAX_AGE_MS} are
 * discarded on restore — a day-old destination is more surprising than helpful.
 */

export const PENDING_ROUTE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

const STORAGE_KEY = "stormpath-pending-route-v1";

export type PendingRequest =
  | { kind: "route"; end: [number, number]; label: string; createdAt: number }
  | { kind: "search"; query: string; createdAt: number };

export interface PendingRouteState {
  pending: PendingRequest | null;
  setPending: (p: PendingRequest | null) => void;
  clearPending: () => void;
}

function isPendingRequest(value: unknown): value is PendingRequest {
  if (!value || typeof value !== "object") return false;
  const p = value as Partial<PendingRequest> & { kind?: string };
  if (typeof p.createdAt !== "number") return false;
  if (p.kind === "search") return typeof (p as { query?: unknown }).query === "string";
  if (p.kind === "route") {
    const end = (p as { end?: unknown }).end;
    return (
      Array.isArray(end) &&
      end.length === 2 &&
      typeof end[0] === "number" &&
      typeof end[1] === "number" &&
      typeof (p as { label?: unknown }).label === "string"
    );
  }
  return false;
}

function loadPersistedPending(): PendingRequest | null {
  const p = safeStorage.getJson<unknown>(STORAGE_KEY, null);
  if (!isPendingRequest(p)) {
    if (p != null) safeStorage.remove(STORAGE_KEY);
    return null;
  }
  if (Date.now() - p.createdAt > PENDING_ROUTE_MAX_AGE_MS) {
    safeStorage.remove(STORAGE_KEY);
    return null;
  }
  return p;
}

export const usePendingRouteStore = create<PendingRouteState>((set) => ({
  pending: loadPersistedPending(),

  setPending: (p) => {
    if (p) safeStorage.setJson(STORAGE_KEY, p);
    else safeStorage.remove(STORAGE_KEY);
    set({ pending: p });
  },

  clearPending: () => {
    safeStorage.remove(STORAGE_KEY);
    set({ pending: null });
  },
}));
