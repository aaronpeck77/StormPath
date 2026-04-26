/**
 * Subscription / pay tier — single place to gate Plus features.
 *
 * Tier inventory: `docs/PAY_TIERS.md`
 *
 * **Development (`vite` / `import.meta.env.DEV`):** defaults to **Plus** so everything is on.
 * To test **Basic** in dev: `localStorage.setItem("stormpath-pay-tier-override", "free")` then refresh (or set
 * `VITE_PAY_TIER` / Netlify env for production-shaped builds).
 *
 * **Production build (Netlify / phone):** defaults to **Basic** unless `VITE_PAY_TIER=plus` in the build env
 * (and in Netlify **Site configuration → Environment variables**) or `localStorage stormpath-pay-tier-override` = `plus`.
 *
 * **Plus** unlocks storm/NWS advisory UI, traffic overlay, weather hints, auto re-route, and frequent-route learning.
 * **Basic** is navigation + radar only (no storm polygons, no traffic APIs, no hazard “road & traffic” toggles).
 */
export type PayTier = "free" | "plus";

const LS_OVERRIDE = "stormpath-pay-tier-override";

export function getPayTier(): PayTier {
  try {
    const o = localStorage.getItem(LS_OVERRIDE)?.toLowerCase();
    if (o === "plus" || o === "pro") return "plus";
    if (o === "free") return "free";
  } catch {
    /* ignore */
  }
  const v = (import.meta.env.VITE_PAY_TIER as string | undefined)?.toLowerCase();
  if (v === "plus" || v === "pro") return "plus";
  if (import.meta.env.DEV) return "plus";
  return "free";
}

export function hasPlusTier(): boolean {
  return getPayTier() === "plus";
}

export function hasFrequentRoutesLearning(): boolean {
  return hasPlusTier();
}
