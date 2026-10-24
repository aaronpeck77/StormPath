/**
 * Offline state management hook.
 *
 * Tracks network connectivity and provides offline-first state machine:
 * - Online: Full functionality
 * - Degraded: Limited functionality (slow connection)
 * - Offline: Offline mode with cached data
 */

import { useState, useEffect } from "react";

export type OfflineMode = "online" | "degraded" | "offline";

interface OfflineState {
  mode: OfflineMode;
  isOnline: boolean;
  lastOnlineTime: number | null;
}

/**
 * Hook to track offline state and provide network status.
 *
 * @returns Current offline state
 *
 * @example
 * ```ts
 * const { mode, isOnline } = useOfflineState();
 *
 * if (mode === 'offline') {
 *   // Show offline UI
 * }
 * ```
 */
export function useOfflineState(): OfflineState {
  const [state, setState] = useState<OfflineState>({
    mode: "online",
    isOnline: true,
    lastOnlineTime: null,
  });

  useEffect(() => {
    const updateState = () => {
      const isOnline = navigator.onLine;
      const connection = (navigator as any).connection;

      let mode: OfflineMode = isOnline ? "online" : "offline";

      // Check for degraded connection (slow cellular)
      if (isOnline && connection) {
        const effectiveType = connection.effectiveType;
        const saveData = connection.saveData;

        if (saveData || effectiveType === "2g" || effectiveType === "slow-2g") {
          mode = "degraded";
        }
      }

      setState((prev) => ({
        mode,
        isOnline,
        lastOnlineTime: isOnline ? Date.now() : prev.lastOnlineTime,
      }));
    };

    // Initial check
    updateState();

    // Listen for online/offline events
    window.addEventListener("online", updateState);
    window.addEventListener("offline", updateState);

    // Listen for connection changes (where supported)
    const connection = (navigator as any).connection;
    if (connection) {
      connection.addEventListener("change", updateState);
    }

    return () => {
      window.removeEventListener("online", updateState);
      window.removeEventListener("offline", updateState);
      if (connection) {
        connection.removeEventListener("change", updateState);
      }
    };
  }, []);

  return state;
}

/**
 * Check if the app should use offline mode for a specific feature.
 *
 * @param offlineState - Current offline state from useOfflineState
 * @param featureRequiresHighBandwidth - Whether the feature needs good connectivity
 * @returns True if the feature should use offline/cached data
 */
export function shouldUseOfflineMode(
  offlineState: OfflineState,
  featureRequiresHighBandwidth: boolean = false
): boolean {
  if (offlineState.mode === "offline") return true;
  if (offlineState.mode === "degraded" && featureRequiresHighBandwidth) return true;
  return false;
}
