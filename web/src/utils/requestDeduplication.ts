/**
 * Request deduplication cache.
 *
 * Prevents duplicate in-flight API calls for the same request key.
 * When multiple components request the same data simultaneously, only one
 * network request is made and all callers share the same Promise.
 *
 * This is especially valuable for:
 * - Mapbox Directions (expensive API)
 * - Weather API calls (rate-limited)
 * - Traffic overlay fetches
 */

type PendingRequest = {
  promise: Promise<unknown>;
  timestamp: number;
};

const pendingRequests = new Map<string, PendingRequest>();

/**
 * Default TTL for pending requests (5 minutes).
 * After this time, a new request will be issued even if one is still pending.
 */
const DEFAULT_TTL_MS = 5 * 60 * 1000;

/**
 * Deduplicate an async request by key.
 *
 * If a request with the same key is already in-flight, returns the existing Promise.
 * Otherwise, executes the request function and caches the result.
 *
 * @param key - Unique identifier for this request (e.g., URL + params hash)
 * @param requestFn - Function that returns a Promise for the actual request
 * @param ttlMs - Time-to-live for cached pending requests (default: 5 minutes)
 *
 * @example
 * ```ts
 * const data = await dedupeRequest(
 *   `directions:${origin}:${dest}`,
 *   () => fetchDirections(origin, dest),
 *   30000
 * );
 * ```
 */
export async function dedupeRequest<T>(
  key: string,
  requestFn: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<T> {
  const now = Date.now();

  // Check for existing in-flight request
  const existing = pendingRequests.get(key);
  if (existing) {
    // If it's still within TTL, return the existing promise
    if (now - existing.timestamp < ttlMs) {
      return existing.promise as Promise<T>;
    }
    // Otherwise, clean up the stale entry
    pendingRequests.delete(key);
  }

  // Create new request
  const promise = requestFn();
  pendingRequests.set(key, { promise, timestamp: now });

  // Clean up after request completes (success or failure)
  promise.finally(() => {
    // Small delay to allow concurrent callers to also resolve
    setTimeout(() => {
      pendingRequests.delete(key);
    }, 100);
  });

  return promise;
}

/**
 * Clear all pending requests.
 *
 * Call this when navigation changes or the user explicitly cancels an operation.
 */
export function clearPendingRequests(): void {
  pendingRequests.clear();
}

/**
 * Clear pending requests matching a prefix.
 *
 * Useful for clearing all weather requests when the user toggles weather off,
 * or all route requests when a new destination is set.
 *
 * @param prefix - Key prefix to match (e.g., "weather:", "directions:")
 */
export function clearPendingRequestsByPrefix(prefix: string): void {
  for (const key of pendingRequests.keys()) {
    if (key.startsWith(prefix)) {
      pendingRequests.delete(key);
    }
  }
}

/**
 * Get the number of currently pending requests.
 *
 * Useful for debugging and monitoring.
 */
export function getPendingRequestCount(): number {
  return pendingRequests.size;
}
