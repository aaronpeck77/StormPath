import { Capacitor } from "@capacitor/core";
import { StormpathDeviceMotion } from "@stormpath/device-motion";
import type { TripActivityHint } from "../frequentRoutes/tripDetector";

export type DeviceMotionActivityResult = {
  activity: TripActivityHint;
  confidence: number | null;
};

const HINTS = new Set<TripActivityHint>([
  "automotive",
  "cycling",
  "on_foot",
  "still",
  "unknown",
]);

function normalizeActivity(raw: string | undefined): TripActivityHint {
  if (raw && HINTS.has(raw as TripActivityHint)) return raw as TripActivityHint;
  return "unknown";
}

export function isDeviceMotionSupported(): boolean {
  return Capacitor.isNativePlatform();
}

export async function readDeviceMotionActivity(): Promise<DeviceMotionActivityResult> {
  if (!Capacitor.isNativePlatform()) {
    return { activity: "unknown", confidence: null };
  }
  try {
    const cur = await StormpathDeviceMotion.getCurrent();
    return {
      activity: normalizeActivity(cur?.activity),
      confidence: typeof cur?.confidence === "number" ? cur.confidence : null,
    };
  } catch {
    return { activity: "unknown", confidence: null };
  }
}

export async function startDeviceMotionUpdates(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const r = await StormpathDeviceMotion.start();
    return Boolean(r?.ok);
  } catch {
    return false;
  }
}

export async function stopDeviceMotionUpdates(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await StormpathDeviceMotion.stop();
  } catch {
    /* ignore */
  }
}
