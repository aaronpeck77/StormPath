import { beforeEach, describe, expect, it, vi } from "vitest";

const KEY = "stormpath-pending-route-v1";

let mem: Map<string, string>;

async function freshStore() {
  vi.resetModules();
  return import("../pendingRouteStore");
}

beforeEach(() => {
  mem = new Map();
  /* safeStorage falls back to window.localStorage on web — stub a minimal one. */
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
      setItem: (k: string, v: string) => void mem.set(k, String(v)),
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(),
      key: (i: number) => [...mem.keys()][i] ?? null,
      get length() {
        return mem.size;
      },
    },
  });
});

describe("pendingRouteStore", () => {
  it("setPending persists to safeStorage", async () => {
    const { usePendingRouteStore } = await freshStore();
    const p = { kind: "route", end: [-89.6, 39.8], label: "Home", createdAt: Date.now() } as const;
    usePendingRouteStore.getState().setPending({ ...p, end: [...p.end] });
    expect(usePendingRouteStore.getState().pending?.kind).toBe("route");
    expect(JSON.parse(mem.get(KEY)!)).toMatchObject({ kind: "route", label: "Home" });
  });

  it("restores a fresh persisted entry on init", async () => {
    mem.set(
      KEY,
      JSON.stringify({ kind: "search", query: "coffee", createdAt: Date.now() - 60_000 })
    );
    const { usePendingRouteStore } = await freshStore();
    expect(usePendingRouteStore.getState().pending).toMatchObject({
      kind: "search",
      query: "coffee",
    });
  });

  it("discards a persisted entry older than 6 hours", async () => {
    const { PENDING_ROUTE_MAX_AGE_MS } = await import("../pendingRouteStore");
    mem.set(
      KEY,
      JSON.stringify({
        kind: "route",
        end: [-89.6, 39.8],
        label: "Home",
        createdAt: Date.now() - PENDING_ROUTE_MAX_AGE_MS - 1_000,
      })
    );
    const { usePendingRouteStore } = await freshStore();
    expect(usePendingRouteStore.getState().pending).toBeNull();
    expect(mem.has(KEY)).toBe(false);
  });

  it("clearPending removes storage", async () => {
    const { usePendingRouteStore } = await freshStore();
    usePendingRouteStore.getState().setPending({
      kind: "search",
      query: "gas",
      createdAt: Date.now(),
    });
    expect(mem.has(KEY)).toBe(true);
    usePendingRouteStore.getState().clearPending();
    expect(usePendingRouteStore.getState().pending).toBeNull();
    expect(mem.has(KEY)).toBe(false);
  });
});
