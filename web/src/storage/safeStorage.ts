import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";

/**
 * Persistent key/value storage that survives app updates on iOS/Android.
 *
 * **Why not raw `window.localStorage`?** WKWebView’s localStorage lives in a sandbox that can be
 * purged by the OS under storage pressure or after iCloud restore. Capacitor `Preferences` writes
 * to native `NSUserDefaults` / `SharedPreferences`, which survive both. We keep the same sync
 * API that React `useState(() => readSetting())` initializers expect by hydrating an in-memory
 * cache from the native store at boot, then doing async write-through on every mutation.
 *
 * **On web (`npm run dev`, Netlify):** backing store is plain `window.localStorage`. Cache is
 * still used so behavior is identical across platforms and tests don’t need a real DOM.
 *
 * **Migration:** the first time {@link hydrateSafeStorage} runs on a native build, any keys
 * found in WKWebView’s legacy localStorage are copied into Preferences (only if Preferences
 * doesn’t already have them). Existing testers therefore keep their saved data on the upgrade.
 *
 * Returns `null` for missing values; never throws.
 */

const cache = new Map<string, string>();

function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export const safeStorage = {
  get(key: string): string | null {
    if (cache.has(key)) return cache.get(key) ?? null;
    /* Cold-read fallback for code that runs before hydration finishes. Web only — Preferences is async. */
    if (!isNative() && typeof window !== "undefined") {
      try {
        const v = window.localStorage.getItem(key);
        if (v != null) cache.set(key, v);
        return v;
      } catch {
        return null;
      }
    }
    return null;
  },

  set(key: string, value: string): void {
    cache.set(key, value);
    if (isNative()) {
      void Preferences.set({ key, value }).catch(() => {
        /* swallow — cache still serves reads this session */
      });
      return;
    }
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* swallow — quota / private mode / partitioned */
    }
  },

  remove(key: string): void {
    cache.delete(key);
    if (isNative()) {
      void Preferences.remove({ key }).catch(() => {
        /* swallow */
      });
      return;
    }
    if (typeof window === "undefined") return;
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

let hydrated = false;
let hydratePromise: Promise<void> | null = null;

/**
 * Populate the in-memory cache from the persistent backing store. Call once from `main.tsx`
 * before `createRoot().render()` so React initializers see persisted values synchronously.
 *
 * Native: reads every key from `Preferences`. Migrates legacy localStorage keys to Preferences
 * the first time it runs (so existing testers keep their data). Web: reads everything from
 * `window.localStorage` into the cache (preserves existing behavior).
 *
 * Safe to call multiple times — second call is a no-op.
 */
export async function hydrateSafeStorage(): Promise<void> {
  if (hydrated) return;
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    if (isNative()) {
      try {
        const { keys } = await Preferences.keys();
        const known = new Set(keys);
        await Promise.all(
          keys.map(async (key) => {
            try {
              const { value } = await Preferences.get({ key });
              if (value != null) cache.set(key, value);
            } catch {
              /* ignore individual key read failure */
            }
          })
        );
        /* One-shot migration: copy WKWebView localStorage values that aren't yet in Preferences. */
        if (typeof window !== "undefined") {
          try {
            const ls = window.localStorage;
            for (let i = 0; i < ls.length; i += 1) {
              const key = ls.key(i);
              if (!key) continue;
              if (known.has(key)) continue;
              const value = ls.getItem(key);
              if (value == null) continue;
              cache.set(key, value);
              try {
                await Preferences.set({ key, value });
              } catch {
                /* swallow — cache still serves */
              }
            }
          } catch {
            /* localStorage unreachable on this WebView; nothing to migrate */
          }
        }
      } catch {
        /* Preferences plugin failed entirely — fall back to localStorage hydration. */
        if (typeof window !== "undefined") {
          try {
            const ls = window.localStorage;
            for (let i = 0; i < ls.length; i += 1) {
              const key = ls.key(i);
              if (!key) continue;
              const v = ls.getItem(key);
              if (v != null) cache.set(key, v);
            }
          } catch {
            /* nothing to do */
          }
        }
      }
    } else if (typeof window !== "undefined") {
      try {
        const ls = window.localStorage;
        for (let i = 0; i < ls.length; i += 1) {
          const key = ls.key(i);
          if (!key) continue;
          const v = ls.getItem(key);
          if (v != null) cache.set(key, v);
        }
      } catch {
        /* nothing to do */
      }
    }
    hydrated = true;
  })();
  return hydratePromise;
}

/** Test-only: drop the cache and let the next call re-hydrate. Avoid in app code. */
export function __resetSafeStorageForTests(): void {
  cache.clear();
  hydrated = false;
  hydratePromise = null;
}
