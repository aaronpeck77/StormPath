/**
 * Tiny wrapper around `window.localStorage` that never throws.
 *
 * Background: Safari private mode, iOS WKWebView storage partitioning, and
 * "storage quota exceeded" can all turn a `localStorage.setItem(...)` into an
 * uncaught `DOMException` that breaks unrelated UI flows. Use these helpers
 * instead of touching `localStorage` directly.
 *
 * Returns `null` (or silently ignores) on any failure — callers must already
 * tolerate a missing value (storage is per-device and per-browser anyway).
 */
export const safeStorage = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* swallow — quota / private mode / partitioned */
    }
  },
  remove(key: string): void {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* swallow */
    }
  },
  /** JSON convenience: returns `fallback` if missing/corrupt. */
  getJson<T>(key: string, fallback: T): T {
    const raw = safeStorage.get(key);
    if (raw == null) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  },
  setJson(key: string, value: unknown): void {
    try {
      safeStorage.set(key, JSON.stringify(value));
    } catch {
      /* swallow stringify errors (cyclic objects, etc.) */
    }
  },
};
