import { Capacitor } from "@capacitor/core";
import { Network } from "@capacitor/network";

/** Allowed by `connect-src` in `web/public/_headers`. HTTP status still means the host answered. */
const REACHABILITY_URL = "https://api.mapbox.com/";

export const MAP_REACHABILITY_TIMEOUT_MS = 4_000;

export type ProbeMapReachabilityDeps = {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  navigatorOnLine?: boolean;
};

/**
 * Cheap "can we reach the map host" check. `navigator.onLine` stays true in many
 * dead zones; a timed-out fetch does not.
 */
export async function probeMapReachability(deps: ProbeMapReachabilityDeps = {}): Promise<boolean> {
  const online =
    deps.navigatorOnLine ?? (typeof navigator === "undefined" ? true : navigator.onLine);
  if (!online) return false;

  const timeoutMs = deps.timeoutMs ?? MAP_REACHABILITY_TIMEOUT_MS;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    await fetchImpl(REACHABILITY_URL, {
      method: "GET",
      cache: "no-store",
      signal: ac.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function readNativeNetworkConnected(): Promise<boolean | null> {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const status = await Network.getStatus();
    return status.connected;
  } catch {
    return null;
  }
}
