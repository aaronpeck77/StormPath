import { useEffect, useRef, useState } from "react";
import { consumeCarPlayHazardAlert } from "../services/carSessionPublish";

const POLL_MS = 3_000;

/**
 * Hazard titles the CarPlay scene announced via its "check your phone" popup.
 * The native side drops the announced set into UserDefaults once per alert;
 * we poll while the car is connected and accumulate titles for the drive so
 * the companion page can highlight exactly what the alert meant. Resets when
 * navigation ends or CarPlay disconnects.
 */
export function useCarPlayHazardAlerts(active: boolean, navigating: boolean): string[] {
  const [titles, setTitles] = useState<string[]>([]);
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!active || !navigating) {
      seenRef.current = new Set();
      setTitles([]);
      return;
    }
    let alive = true;
    const tick = () => {
      void consumeCarPlayHazardAlert().then((announced) => {
        if (!alive || announced.length === 0) return;
        let added = false;
        for (const t of announced) {
          if (!seenRef.current.has(t)) {
            seenRef.current.add(t);
            added = true;
          }
        }
        if (added) setTitles([...seenRef.current]);
      });
    };
    tick();
    const timer = window.setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [active, navigating]);

  return titles;
}
