/**
 * Background sync queue for offline changes.
 *
 * When offline, queue operations (saved places, settings, routes).
 * Sync when connection returns.
 */

type QueuedOperation = {
  id: string;
  type: "save_place" | "save_route" | "setting" | "trip";
  data: unknown;
  timestamp: number;
  retryCount: number;
};

const queue: QueuedOperation[] = [];
const SYNC_DELAY_MS = 5000;

let syncTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Add an operation to the sync queue.
 */
export function enqueueOperation(
  type: QueuedOperation["type"],
  data: unknown
): void {
  queue.push({
    id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    type,
    data,
    timestamp: Date.now(),
    retryCount: 0,
  });
}

/**
 * Process the sync queue when online.
 */
export function processSyncQueue(): void {
  if (queue.length === 0) return;

  // In a real implementation, this would actually sync to your backend
  // For now, we just mark it as processed
  queue.shift();

  if (queue.length > 0) {
    syncTimer = setTimeout(processSyncQueue, SYNC_DELAY_MS);
  }
}

/**
 * Clear the sync queue.
 */
export function clearSyncQueue(): void {
  queue.length = 0;
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }
}

/**
 * Get queue size for debugging.
 */
export function getSyncQueueSize(): number {
  return queue.length;
}
