import { Capacitor } from "@capacitor/core";
import { StormpathCarSession } from "@stormpath/car-session";

/** Push trip/advisory snapshot for a future CarPlay scene (no-op on web). */
export async function publishCarSession(payload: {
  navigating: boolean;
  destinationLabel?: string | null;
  advisoryLine?: string | null;
  maneuverLine?: string | null;
}): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    if (!payload.navigating) {
      await StormpathCarSession.clear();
      return;
    }
    await StormpathCarSession.publish({
      navigating: true,
      destinationLabel: payload.destinationLabel?.trim() || "",
      advisoryLine: payload.advisoryLine?.trim() || "",
      maneuverLine: payload.maneuverLine?.trim() || "",
    });
  } catch {
    /* CarPlay bridge optional until entitlement + scene are live */
  }
}
