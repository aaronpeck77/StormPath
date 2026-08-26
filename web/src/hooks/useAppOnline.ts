import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Network } from "@capacitor/network";
import { readNativeNetworkConnected } from "../monitoring/mapReachabilityProbe";
import {
  NETWORK_HANDOFF_GRACE_MS,
  NETWORK_RECONNECT_POLL_MS,
  nextOnlineState,
  resolveRadioUp,
} from "../monitoring/networkConnectivity";

function navigatorIsOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

/**
 * App-wide "radio is up" flag.
 *
 * On iOS, `navigator.onLine` + `offline`/`online` are not enough: leaving home
 * Wi‑Fi looks like a dead zone, and a later cellular link often never fires
 * `online` until the WebView is destroyed (kill + reopen). Native Network
 * status plus a short handoff grace is the source of truth on device.
 */
export function useAppOnline(): boolean {
  const [isOnline, setIsOnline] = useState(() =>
    Capacitor.isNativePlatform()
      ? true
      : typeof navigator === "undefined"
        ? true
        : navigator.onLine
  );

  useEffect(() => {
    let cancelled = false;
    let nativeConnected: boolean | null = Capacitor.isNativePlatform() ? null : null;
    let downSinceMs: number | null = null;
    let graceTimer: number | null = null;
    let listener: { remove: () => Promise<void> } | null = null;

    const publish = () => {
      if (cancelled) return;
      const radioUp = resolveRadioUp({
        navigatorOnLine: navigatorIsOnline(),
        nativeConnected,
      });
      const next = nextOnlineState({
        radioUp,
        downSinceMs,
        nowMs: Date.now(),
        graceMs: NETWORK_HANDOFF_GRACE_MS,
      });
      downSinceMs = next.downSinceMs;
      setIsOnline(next.isOnline);
      if (graceTimer != null) {
        window.clearTimeout(graceTimer);
        graceTimer = null;
      }
      if (!radioUp && next.isOnline && downSinceMs != null) {
        const wait = Math.max(0, NETWORK_HANDOFF_GRACE_MS - (Date.now() - downSinceMs));
        graceTimer = window.setTimeout(() => {
          graceTimer = null;
          publish();
        }, wait);
      }
    };

    const refreshNative = async () => {
      if (Capacitor.isNativePlatform()) {
        nativeConnected = await readNativeNetworkConnected();
      }
      if (!cancelled) publish();
    };

    window.addEventListener("online", publish);
    window.addEventListener("offline", publish);
    const onVis = () => {
      if (document.visibilityState === "visible") void refreshNative();
    };
    document.addEventListener("visibilitychange", onVis);

    void refreshNative();
    if (Capacitor.isNativePlatform()) {
      void Network.addListener("networkStatusChange", (status) => {
        nativeConnected = status.connected;
        publish();
      }).then((handle) => {
        if (cancelled) {
          void handle.remove();
          return;
        }
        listener = handle;
      });
    }

    const poll = window.setInterval(() => {
      if (cancelled) return;
      const radioUp = resolveRadioUp({
        navigatorOnLine: navigatorIsOnline(),
        nativeConnected,
      });
      if (!radioUp || downSinceMs != null) void refreshNative();
    }, NETWORK_RECONNECT_POLL_MS);

    return () => {
      cancelled = true;
      window.removeEventListener("online", publish);
      window.removeEventListener("offline", publish);
      document.removeEventListener("visibilitychange", onVis);
      window.clearInterval(poll);
      if (graceTimer != null) window.clearTimeout(graceTimer);
      void listener?.remove();
    };
  }, []);

  return isOnline;
}
