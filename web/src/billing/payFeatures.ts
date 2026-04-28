import { Capacitor } from "@capacitor/core";

/**
 * Subscription / pay tier — single place to gate Plus features.
 *
 * Tier inventory: `docs/PAY_TIERS.md`
 *
 * **Development (`vite` / `import.meta.env.DEV`):** defaults to **Plus** so everything is on.
 * To test **Basic**: About → **Test pay tier** → Basic (when the panel is enabled), or set
 * `localStorage.setItem(PAY_TIER_OVERRIDE_LS_KEY, "free")` (or set `VITE_PAY_TIER` / Netlify for production-shaped
 * builds).
 *
 * **Production web (Netlify):** defaults to **Basic** unless `VITE_PAY_TIER=plus` or `localStorage` override.
 * **Capacitor iOS/Android:** defaults to **Plus** when `VITE_PAY_TIER` is unset so TestFlight/NWS/traffic work
 * before billing is wired; set `VITE_PAY_TIER=free` to test Basic on device.
 *
 * **Plus** unlocks storm/NWS advisory UI, traffic overlay, weather hints, auto re-route, and frequent-route learning.
 * **Basic** is navigation + radar only (no storm polygons, no traffic APIs, no hazard “road & traffic” toggles).
 */
export type PayTier = "free" | "plus";

/** `localStorage` key — dev About toggle and manual QA use the same mechanism as production. */
export const PAY_TIER_OVERRIDE_LS_KEY = "stormpath-pay-tier-override";

export function getPayTier(): PayTier {
  try {
    const o = localStorage.getItem(PAY_TIER_OVERRIDE_LS_KEY)?.toLowerCase();
    if (o === "plus" || o === "pro") return "plus";
    if (o === "free") return "free";
  } catch {
    /* ignore */
  }
  const v = (import.meta.env.VITE_PAY_TIER as string | undefined)?.toLowerCase();
  if (v === "plus" || v === "pro") return "plus";
  if (v === "free") return "free";
  if (import.meta.env.DEV) return "plus";
  if (Capacitor.isNativePlatform()) return "plus";
  return "free";
}

export function hasPlusTier(): boolean {
  return getPayTier() === "plus";
}

export function hasFrequentRoutesLearning(): boolean {
  return hasPlusTier();
}
