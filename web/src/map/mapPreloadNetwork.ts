import { Capacitor } from "@capacitor/core";
import { Network } from "@capacitor/network";

/** True when connected on Wi‑Fi (or dev browser for local testing). */
export async function isWifiConnection(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) {
    return typeof navigator !== "undefined" && navigator.onLine;
  }
  try {
    const status = await Network.getStatus();
    return status.connected && status.connectionType === "wifi";
  } catch {
    return false;
  }
}
