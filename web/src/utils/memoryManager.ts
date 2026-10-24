/**
 * Memory management utilities.
 *
 * Helps prevent memory leaks and reduces memory pressure during navigation.
 */

/**
 * Clear a timeout or interval and nullify the reference.
 *
 * @param timerId - The timer ID to clear
 */
export function clearTimer(timerId: ReturnType<typeof setTimeout> | null): void {
  if (timerId !== null) {
    clearTimeout(timerId);
    clearInterval(timerId);
  }
}

/**
 * Clear multiple timeouts/intervals at once.
 *
 * @param timerIds - Array of timer IDs to clear
 */
export function clearTimers(timerIds: Array<ReturnType<typeof setTimeout> | null>): void {
  timerIds.forEach((id) => clearTimer(id));
}

/**
 * Abort an AbortController and nullify the reference.
 *
 * @param controller - The AbortController to abort
 */
export function abortController(controller: AbortController | null): void {
  if (controller !== null) {
    controller.abort();
  }
}

/**
 * Clean up route data after navigation ends.
 *
 * This should be called when:
 * - The user clears a trip
 * - Navigation completes (arrival)
 * - The app background/exits during navigation
 *
 * @param tripData - Trip data to clean up
 */
export function cleanupTripData(tripData: {
  routes?: unknown[];
  forecast?: unknown;
  trafficOverlay?: unknown;
}): void {
  // Nullify large objects to help garbage collection
  if (tripData.routes) {
    tripData.routes.length = 0;
  }
  tripData.forecast = null;
  tripData.trafficOverlay = null;
}

/**
 * Check memory pressure (where supported).
 *
 * @returns True if the device is under memory pressure
 */
export function isUnderMemoryPressure(): boolean {
  // Chrome/Edge support memory pressure API
  if ("memory" in performance) {
    const memory = (performance as any).memory;
    if (memory && memory.jsHeapSizeLimit) {
      const used = memory.usedJSHeapSize;
      const limit = memory.jsHeapSizeLimit;
      // If using more than 80% of heap limit, consider it under pressure
      return used / limit > 0.8;
    }
  }
  return false;
}

/**
 * Force garbage collection hint (dev only).
 *
 * In development, this can help identify memory leaks.
 * In production, this is a no-op.
 */
export function forceGcHint(): void {
  if (import.meta.env.DEV && "gc" in window) {
    (window as any).gc();
  }
}

/**
 * Debounce memory-intensive operations.
 *
 * @param fn - Function to debounce
 * @param delay - Delay in milliseconds
 * @returns Debounced function
 */
export function debounceMemoryHeavy<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return (...args: Parameters<T>) => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      fn(...args);
      timeoutId = null;
    }, delay);
  };
}
