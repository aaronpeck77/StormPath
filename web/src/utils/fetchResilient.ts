/**
 * Resilient HTTP helpers for slow or flaky mobile networks: bounded wait times,
 * optional external cancellation, and a distinct timeout error for user messaging.
 */

export const MAPBOX_DIRECTIONS_TIMEOUT_MS = 55_000;
export const MAPBOX_TRAFFIC_TIMEOUT_MS = 32_000;
export const MAPBOX_GEOCODE_TIMEOUT_MS = 22_000;
export const OPENWEATHER_TIMEOUT_MS = 20_000;

export class FetchTimeoutError extends Error {
  constructor() {
    super("Request timed out");
    this.name = "FetchTimeoutError";
  }
}

export function isAbortError(e: unknown): boolean {
  if (e instanceof DOMException && e.name === "AbortError") return true;
  if (e instanceof Error && e.name === "AbortError") return true;
  return false;
}

export function isFetchTimeoutError(e: unknown): boolean {
  return e instanceof FetchTimeoutError;
}

/** True when the user has asked the OS to minimize data (Chrome / some Android). */
export function isSaveDataPreferred(): boolean {
  try {
    const c = (navigator as Navigator & { connection?: { saveData?: boolean } })
      .connection;
    return Boolean(c?.saveData);
  } catch {
    return false;
  }
}

type FetchArgs = {
  input: RequestInfo | URL;
  init?: RequestInit;
  timeoutMs: number;
  /** When aborted, the request is cancelled (e.g. new route / clear). */
  externalSignal?: AbortSignal;
};

/**
 * `fetch` with a wall-clock timeout. On timeout, throws {@link FetchTimeoutError}
 * (unless the external signal already aborted — then {@link isAbortError}).
 */
export async function fetchWithTimeout({
  input,
  init,
  timeoutMs,
  externalSignal,
}: FetchArgs): Promise<Response> {
  const ctrl = new AbortController();
  let timedOut = false;
  const t = window.setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);

  const onExtAbort = () => {
    window.clearTimeout(t);
    ctrl.abort();
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      window.clearTimeout(t);
      throw new DOMException("Aborted", "AbortError");
    }
    externalSignal.addEventListener("abort", onExtAbort, { once: true });
  }

  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } catch (e) {
    if (timedOut && (!externalSignal || !externalSignal.aborted)) {
      throw new FetchTimeoutError();
    }
    throw e;
  } finally {
    window.clearTimeout(t);
    if (externalSignal) {
      externalSignal.removeEventListener("abort", onExtAbort);
    }
  }
}

export function isRetryableFetchError(e: unknown): boolean {
  if (isAbortError(e) || isFetchTimeoutError(e)) return false;
  if (e instanceof TypeError) return true; // DNS / dropped connection
  return false;
}

export function isRetryableHttpStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

/**
 * When a {@link FetchTimeoutError} or slow network occurs during routing, prefer this copy.
 * Returns null for {@link isAbortError} (superseded request — do not show an error).
 */
export function routeFetchUserMessage(e: unknown): string | null {
  if (isAbortError(e)) return null;
  if (isFetchTimeoutError(e)) {
    return "The connection is slow or unavailable. Try again with a stronger cell signal or Wi‑Fi.";
  }
  return null;
}
