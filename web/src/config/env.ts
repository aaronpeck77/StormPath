import { Capacitor } from "@capacitor/core";

/** Vite injects only vars prefixed with VITE_. Never commit real keys — use `.env.local`. */
/** Plus: see `billing/payFeatures.ts` and `docs/PAY_TIERS.md` (dev server defaults to Plus). */

function computeNwsApiBase(): string {
  const custom = (import.meta.env.VITE_NWS_API_BASE as string | undefined)?.trim();
  if (custom) return custom;
  /** Capacitor has no Vite proxy — relative `/weather-gov` breaks native HTTP and WKWebView fetch. */
  if (Capacitor.isNativePlatform()) return "https://api.weather.gov";
  if (import.meta.env.DEV) return "/weather-gov";
  return "https://api.weather.gov";
}

export function getWebEnv() {
  return {
    mapboxToken: (import.meta.env.VITE_MAPBOX_TOKEN as string | undefined)?.trim() ?? "",
    openWeatherApiKey: (import.meta.env.VITE_OPENWEATHER_API_KEY as string | undefined)?.trim() ?? "",
    /** When true, US NWS active alerts (polygons) + advisory strip are available (future: gate on subscription). */
    stormAdvisoryEnabled: import.meta.env.VITE_STORM_ADVISORY_ENABLED !== "false",
    /**
     * Optional origin/path for NWS `alerts/active` (no trailing slash). Dev defaults to `/weather-gov` (Vite proxy).
     * Native apps always use `https://api.weather.gov` unless overridden (see `computeNwsApiBase`).
     */
    nwsApiBase: computeNwsApiBase(),
    privacyPolicyUrl: (import.meta.env.VITE_PRIVACY_POLICY_URL as string | undefined)?.trim() ?? "",
    termsUrl: (import.meta.env.VITE_TERMS_URL as string | undefined)?.trim() ?? "",
    supportUrl: (import.meta.env.VITE_SUPPORT_URL as string | undefined)?.trim() || "/support.html",
    supportEmail: (import.meta.env.VITE_SUPPORT_EMAIL as string | undefined)?.trim() ?? "",
    upgradeUrl: (import.meta.env.VITE_UPGRADE_URL as string | undefined)?.trim() ?? "",
    manageSubscriptionUrl:
      (import.meta.env.VITE_MANAGE_SUBSCRIPTION_URL as string | undefined)?.trim() ||
      "https://apps.apple.com/account/subscriptions",
    /** Shown in the Basic advisory promo rotation (other apps you ship). */
    siteBibleUrl: (import.meta.env.VITE_SITEBIBLE_URL as string | undefined)?.trim() ?? "",
    /**
     * About → Basic / Plus / Build default tier override (uses `PAY_TIER_OVERRIDE_LS_KEY`). On in dev and in
     * production **unless** `VITE_PAY_TIER_TEST_PANEL=false` — turn off before App Store / paywall.
     */
    payTierTestPanel:
      import.meta.env.DEV ||
      String(import.meta.env.VITE_PAY_TIER_TEST_PANEL ?? "").toLowerCase() !== "false",
  };
}
