import { Capacitor } from "@capacitor/core";
import { StormpathMapboxNavigation } from "@stormpath/mapbox-navigation";
import type { LngLat } from "./types";

/**
 * Brain P2 — "Download this trip" + home-region packs.
 *
 * Wraps the native TripOfflinePack (TileStore corridor + home region). On
 * web/Netlify these are no-ops — the plugin is iOS-only. The packs live on
 * disk in TileStore so they survive app kills and reboots, which is the whole
 * dead-zone value.
 */

export interface OfflinePackStatus {
  packId: string;
  exists: boolean;
  completedResourceCount?: number;
  completedResourceSize?: number;
  requiredResourceCount?: number;
}

function isNativeBridge(): boolean {
  return Capacitor.isNativePlatform();
}

/** Format a byte count for the UI ("~84 MB"). */
export function formatPackSize(bytes: number | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return "unknown size";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1000) return `~${(mb / 1024).toFixed(1)} GB`;
  return `~${Math.max(1, Math.round(mb))} MB`;
}

/**
 * Download the corridor pack along the locked route. Call after Go while the
 * device still has data — the pack is what keeps map + offline routing alive
 * in the dead zone.
 */
export async function downloadTripCorridor(
  accessToken: string,
  routeCoords: LngLat[]
): Promise<{ ok: boolean; packId?: string; error?: string }> {
  if (!isNativeBridge()) return { ok: false, error: "web" };
  if (routeCoords.length < 2) return { ok: false, error: "need route" };
  try {
    const r = await StormpathMapboxNavigation.startTripPack({
      accessToken,
      coordinates: routeCoords,
    });
    return { ok: true, packId: r.packId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Estimate pack size before downloading so the UI can show "~84 MB". */
export async function estimateTripCorridor(
  accessToken: string,
  routeCoords: LngLat[]
): Promise<number | null> {
  if (!isNativeBridge() || routeCoords.length < 2) return null;
  try {
    const r = await StormpathMapboxNavigation.estimateTripPack({
      accessToken,
      coordinates: routeCoords,
    });
    return r.estimatedBytes;
  } catch {
    return null;
  }
}

/** Cancel an in-flight corridor download (user backs out / new route). */
export async function cancelTripCorridor(): Promise<void> {
  if (!isNativeBridge()) return;
  await StormpathMapboxNavigation.cancelTripPack().catch(() => undefined);
}

/** Remove the corridor pack when the trip ends or the user asks. */
export async function removeTripCorridor(): Promise<void> {
  if (!isNativeBridge()) return;
  await StormpathMapboxNavigation.removeTripPack().catch(() => undefined);
}

/** Corridor pack state for diagnostics / About sheet. */
export async function tripCorridorStatus(): Promise<OfflinePackStatus | null> {
  if (!isNativeBridge()) return null;
  try {
    return await StormpathMapboxNavigation.tripPackStatus();
  } catch {
    return null;
  }
}

/** Download/refresh the home region (dead-zone cold starts near home). */
export async function downloadHomeRegion(
  accessToken: string,
  center: LngLat,
  radiusMeters = 40_000
): Promise<{ ok: boolean; error?: string }> {
  if (!isNativeBridge()) return { ok: false, error: "web" };
  try {
    await StormpathMapboxNavigation.setHomeRegion({
      accessToken,
      center,
      radiusMeters,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Home-region pack state for diagnostics. */
export async function homeRegionStatus(): Promise<OfflinePackStatus | null> {
  if (!isNativeBridge()) return null;
  try {
    return await StormpathMapboxNavigation.homeRegionStatus();
  } catch {
    return null;
  }
}
