import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { carPlayConnected } from "../services/carSessionPublish";

const POLL_MS = 2_000;

export type CarPlayPresence = {
  /** CarPlay template scene is attached (phone is plugged in / wireless). */
  connected: boolean;
  /** Scene attached but the car display was "unplugged" from the live trip —
   * the phone keeps navigating on its own map, so the companion must hide. */
  detached: boolean;
};

/**
 * CarPlay presence, polled on native only — scene connect/disconnect has no
 * JS callback, and 2s is fast enough for swapping the phone into companion
 * view. `detached` is the "StormPath-only unplug" flag the native scene
 * writes when the phone asks for its map back mid-trip.
 */
export function useCarPlayActive(): CarPlayPresence {
  const [state, setState] = useState<CarPlayPresence>({ connected: false, detached: false });
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let alive = true;
    const tick = () => {
      void carPlayConnected()
        .then((s) => {
          if (!alive) return;
          setState((prev) =>
            prev.connected === s.connected && prev.detached === s.detached ? prev : s
          );
        })
        .catch(() => undefined);
    };
    tick();
    const timer = window.setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);
  return state;
}
