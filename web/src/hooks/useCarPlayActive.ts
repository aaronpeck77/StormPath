import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { carPlayConnected } from "../services/carSessionPublish";

const POLL_MS = 2_000;

/**
 * Whether a CarPlay template scene is currently attached.
 * Polled on native only — scene connect/disconnect has no JS callback,
 * and 2s is fast enough for swapping the phone into companion view.
 */
export function useCarPlayActive(): boolean {
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let alive = true;
    const tick = () => {
      void carPlayConnected().then((connected) => {
        if (alive) setActive(connected);
      });
    };
    tick();
    const timer = window.setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);
  return active;
}
