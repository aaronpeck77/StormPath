import { useEffect, useRef, useState } from "react";
import type { TripActivityHint } from "../frequentRoutes/tripDetector";
import {
  isDeviceMotionSupported,
  readDeviceMotionActivity,
  startDeviceMotionUpdates,
  stopDeviceMotionUpdates,
} from "../services/deviceMotionActivity";

const POLL_MS = 8_000;

/**
 * Core Motion automotive / walking hint for trip learning.
 * Web and unsupported builds stay on `"unknown"` (GPS-only heuristics).
 */
export function useDeviceMotionActivity(enabled: boolean): TripActivityHint {
  const [activity, setActivity] = useState<TripActivityHint>("unknown");
  const startedRef = useRef(false);

  useEffect(() => {
    if (!enabled || !isDeviceMotionSupported()) {
      setActivity("unknown");
      return;
    }

    let cancelled = false;
    void (async () => {
      const ok = await startDeviceMotionUpdates();
      if (cancelled) return;
      startedRef.current = ok;
      const cur = await readDeviceMotionActivity();
      if (!cancelled) setActivity(cur.activity);
    })();

    const id = window.setInterval(() => {
      void readDeviceMotionActivity().then((cur) => {
        if (!cancelled) setActivity(cur.activity);
      });
    }, POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(id);
      if (startedRef.current) {
        startedRef.current = false;
        void stopDeviceMotionUpdates();
      }
    };
  }, [enabled]);

  return activity;
}
