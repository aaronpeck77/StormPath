/**
 * Optimistic UI update utilities.
 *
 * Update the UI immediately when user changes settings,
 * then roll back if persistence fails.
 */

import { safeStorage } from "../storage/safeStorage";

type OptimisticUpdateResult<T> = {
  success: boolean;
  value: T | null;
  error: Error | null;
};

/**
 * Perform an optimistic update to storage.
 *
 * Updates the UI immediately, then persists to storage.
 * If persistence fails, the UI can roll back to the previous value.
 *
 * @param key - Storage key
 * @param newValue - New value to set
 * @param previousValue - Previous value (for rollback)
 * @param onSuccess - Callback on successful persistence
 * @param onError - Callback on failure (with rollback value)
 *
 * @example
 * ```ts
 * const result = await optimisticUpdate(
 *   'stormpath-setting-radar',
 *   '1',
 *   '0',
 *   () => setRadarEnabled(true),
 *   (prev) => setRadarEnabled(prev === '1')
 * );
 * ```
 */
export async function optimisticUpdate(
  key: string,
  newValue: string,
  previousValue: string | null,
  onSuccess?: () => void,
  onError?: (rollbackValue: string | null) => void
): Promise<OptimisticUpdateResult<string>> {
  try {
    safeStorage.set(key, newValue);
    onSuccess?.();
    return { success: true, value: newValue, error: null };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    // Roll back UI
    onError?.(previousValue);
    return { success: false, value: previousValue, error: err };
  }
}

/**
 * Perform an optimistic JSON update to storage.
 *
 * @param key - Storage key
 * @param newValue - New value to set
 * @param previousValue - Previous value (for rollback)
 * @param onSuccess - Callback on successful persistence
 * @param onError - Callback on failure (with rollback value)
 */
export async function optimisticJsonUpdate<T>(
  key: string,
  newValue: T,
  previousValue: T | null,
  onSuccess?: () => void,
  onError?: (rollbackValue: T | null) => void
): Promise<OptimisticUpdateResult<T>> {
  try {
    safeStorage.setJson(key, newValue);
    onSuccess?.();
    return { success: true, value: newValue, error: null };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    // Roll back UI
    onError?.(previousValue);
    return { success: false, value: previousValue, error: err };
  }
}

/**
 * Batch multiple optimistic updates.
 *
 * All updates are applied immediately, then persisted together.
 * If any fails, all are rolled back.
 *
 * @param updates - Array of update operations
 * @returns Success status and array of results
 */
export async function batchOptimisticUpdates(
  updates: Array<{
    key: string;
    newValue: string;
    previousValue: string | null;
  }>
): Promise<{ success: boolean; results: OptimisticUpdateResult<string>[] }> {
  const results: OptimisticUpdateResult<string>[] = [];
  const rollbackValues: string[] = [];

  try {
    // Apply all updates
    for (const update of updates) {
      safeStorage.set(update.key, update.newValue);
      results.push({ success: true, value: update.newValue, error: null });
      rollbackValues.push(update.previousValue || "");
    }

    return { success: true, results };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));

    // Roll back all updates
    for (let i = 0; i < updates.length; i++) {
      safeStorage.set(updates[i].key, rollbackValues[i]);
      results[i] = {
        success: false,
        value: updates[i].previousValue,
        error: err,
      };
    }

    return { success: false, results };
  }
}
