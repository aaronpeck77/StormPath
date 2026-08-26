/**
 * Phone radio vs WKWebView `navigator.onLine`.
 *
 * iOS Capacitor: leaving home Wi‑Fi fires `offline` immediately. Cellular is often
 * already up, but the WebView can stay "offline" for minutes (or until the app is
 * killed). Native `Network.getStatus().connected` is the radio; trust it first.
 */

/** Stay "online" this long after a drop so Wi‑Fi → cell does not freeze GO. */
export const NETWORK_HANDOFF_GRACE_MS = 2_500;

/** Re-read native status while we think the radio is down — `online` often never fires. */
export const NETWORK_RECONNECT_POLL_MS = 2_000;

export function resolveRadioUp(input: {
  navigatorOnLine: boolean;
  nativeConnected: boolean | null;
}): boolean {
  if (input.nativeConnected === true) return true;
  if (input.nativeConnected === false) return false;
  return input.navigatorOnLine;
}

/**
 * Optimistic during the handoff grace: a 1–2s Wi‑Fi drop should not flip the app
 * to offline. After the grace, a real dead zone is offline until the radio returns.
 */
export function nextOnlineState(input: {
  radioUp: boolean;
  downSinceMs: number | null;
  nowMs: number;
  graceMs?: number;
}): { isOnline: boolean; downSinceMs: number | null } {
  if (input.radioUp) return { isOnline: true, downSinceMs: null };
  const downSinceMs = input.downSinceMs ?? input.nowMs;
  const graceMs = input.graceMs ?? NETWORK_HANDOFF_GRACE_MS;
  return {
    isOnline: input.nowMs - downSinceMs < graceMs,
    downSinceMs,
  };
}
