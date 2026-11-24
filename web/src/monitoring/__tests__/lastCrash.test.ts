import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearLastCrash,
  lastCrashDiagnosticsLines,
  persistLastCrash,
  readLastCrash,
} from "../lastCrash";
import { __resetSafeStorageForTests } from "../../storage/safeStorage";

const KEY = "stormpath.lastCrash.v1";

let mem: Map<string, string>;

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
  __resetSafeStorageForTests();
});

describe("lastCrash", () => {
  it("round-trips an Error record through persist/read", () => {
    persistLastCrash(new Error("boom"), {
      componentStack: "at Foo\nat Bar",
      source: "react_error_boundary",
    });
    const r = readLastCrash();
    expect(r).not.toBeNull();
    expect(r!.message).toBe("boom");
    expect(r!.source).toBe("react_error_boundary");
    expect(r!.componentStack).toContain("at Foo");
    expect(typeof r!.at).toBe("number");
  });

  it("records non-Error reasons (unhandled rejections) as strings", () => {
    persistLastCrash("kaboom string", { source: "unhandled_rejection" });
    expect(readLastCrash()!.message).toBe("kaboom string");
  });

  it("writes localStorage synchronously so the record survives an immediate reload", () => {
    persistLastCrash(new Error("flash crash"), { source: "react_error_boundary" });
    /* Simulate the reload: wipe the in-memory cache, keep localStorage. */
    __resetSafeStorageForTests();
    const r = readLastCrash();
    expect(r).not.toBeNull();
    expect(r!.message).toBe("flash crash");
  });

  it("returns null when nothing was recorded", () => {
    expect(readLastCrash()).toBeNull();
    expect(lastCrashDiagnosticsLines()).toEqual([]);
  });

  it("formats diagnostics lines with source and age", () => {
    persistLastCrash(new Error("cannot read label of undefined"), {
      componentStack: "at CarPlayCompanionBody\nat App",
      source: "react_error_boundary",
    });
    const lines = lastCrashDiagnosticsLines();
    expect(lines[0]).toContain("Last crash");
    expect(lines[0]).toContain("react_error_boundary");
    expect(lines[0]).toContain("cannot read label of undefined");
    expect(lines.some((l) => l.includes("CarPlayCompanionBody"))).toBe(true);
  });

  it("clear removes both stores", () => {
    persistLastCrash(new Error("x"), { source: "react_error_boundary" });
    clearLastCrash();
    expect(readLastCrash()).toBeNull();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });
});
