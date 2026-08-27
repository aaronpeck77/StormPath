import { Capacitor } from "@capacitor/core";
import {
  STORMPATH_PUBLIC_PRIVACY_URL,
  STORMPATH_PUBLIC_SUPPORT_URL,
  STORMPATH_PUBLIC_TERMS_URL,
} from "./publicSite";

const DEFAULT_WEATHERKIT_TOKEN_URL =
  "https://stormpath2.netlify.app/.netlify/functions/weatherkit-token";
const DEFAULT_TOMORROW_IO_TILE_PROXY_URL =
  "https://stormpath2.netlify.app/.netlify/functions/tomorrow-io-tile";

function computeWeatherKitTokenUrl(): string {
  const custom = (import.meta.env.VITE_WEATHERKIT_TOKEN_URL as string | undefined)?.trim();
  if (custom) return custom;
  if (Capacitor.isNativePlatform()) return DEFAULT_WEATHERKIT_TOKEN_URL;
  if (typeof window !== "undefined" && window.location.origin.startsWith("http")) {
    return `${window.location.origin}/.netlify/functions/weatherkit-token`;
  }
  return DEFAULT_WEATHERKIT_TOKEN_URL;
}

/** Vite injects only vars prefixed with VITE_. Never commit real keys — use `.env.local`. */
/** Plus: see `billing/payFeatures.ts` and `docs/PAY_TIERS.md` (dev server defaults to Plus). */

export function payTierTestPanelEnabled(): boolean {
  return (
    import.meta.env.DEV ||
    String(import.meta.env.VITE_PAY_TIER_TEST_PANEL ?? "").toLowerCase() === "true"
  );
}

function computeNwsApiBase(): string {
  const custom = (import.meta.env.VITE_NWS_API_BASE as string | undefined)?.trim();
  if (custom) return custom;
  /** Capacitor has no Vite proxy — relative `/weather-gov` breaks native HTTP and WKWebView fetch. */
  if (Capacitor.isNativePlatform()) return "https://api.weather.gov";
  const host = typeof window !== "undefined" ? window.location.hostname : "";
  const isLocalhost = host === "localhost" || host === "127.0.0.1" || host === "::1";
  /**
   * Browser `npm run dev`: same-origin `/weather-gov` → Vite proxies to api.weather.gov (avoids CORS).
   * `npm run build` / deployed web: direct HTTPS. For local `vite preview`, base is also HTTPS unless you set
   * `VITE_NWS_API_BASE=/weather-gov` in `.env.local` (then use preview proxy in `vite.config.ts`).
   */
  if (import.meta.env.DEV || isLocalhost) return "/weather-gov";
  return "https://api.weather.gov";
}

export function getWebEnv() {
  return {
    mapboxToken: (import.meta.env.VITE_MAPBOX_TOKEN as string | undefined)?.trim() ?? "",
    openWeatherApiKey: (import.meta.env.VITE_OPENWEATHER_API_KEY as string | undefined)?.trim() ?? "",
    tomorrowIoApiKey: (import.meta.env.VITE_TOMORROW_IO_API_KEY as string | undefined)?.trim() ?? "",
    /** CORS-friendly tile proxy for native map radar. Prefer Cloudflare Worker at scale — docs/CLOUDFLARE_TILES.md */
    tomorrowIoTileProxyUrl:
      (import.meta.env.VITE_TOMORROW_IO_TILE_PROXY_URL as string | undefined)?.trim() ||
      DEFAULT_TOMORROW_IO_TILE_PROXY_URL,
    /** Apple WeatherKit via Netlify JWT token function — scales for App Store users. */
    weatherKitEnabled:
      String(import.meta.env.VITE_WEATHERKIT_ENABLED ?? "").toLowerCase() === "true",
    weatherKitTokenUrl: computeWeatherKitTokenUrl(),
    /** When true, US NWS active alerts (polygons) + advisory strip are available (future: gate on subscription). */
    stormAdvisoryEnabled: import.meta.env.VITE_STORM_ADVISORY_ENABLED !== "false",
    /**
     * Optional origin/path for NWS `alerts/active` (no trailing slash). Dev defaults to `/weather-gov` (Vite proxy).
     * Native apps always use `https://api.weather.gov` unless overridden (see `computeNwsApiBase`).
     */
    nwsApiBase: computeNwsApiBase(),
    privacyPolicyUrl:
      (import.meta.env.VITE_PRIVACY_POLICY_URL as string | undefined)?.trim() ||
      STORMPATH_PUBLIC_PRIVACY_URL,
    termsUrl:
      (import.meta.env.VITE_TERMS_URL as string | undefined)?.trim() || STORMPATH_PUBLIC_TERMS_URL,
    supportUrl:
      (import.meta.env.VITE_SUPPORT_URL as string | undefined)?.trim() ||
      STORMPATH_PUBLIC_SUPPORT_URL,
    /** Default inbox when `VITE_SUPPORT_EMAIL` is unset (override in `.env` / host env if needed). */
    supportEmail:
      (import.meta.env.VITE_SUPPORT_EMAIL as string | undefined)?.trim() || "stormpath@yahoo.com",
    upgradeUrl: (import.meta.env.VITE_UPGRADE_URL as string | undefined)?.trim() ?? "",
    manageSubscriptionUrl:
      (import.meta.env.VITE_MANAGE_SUBSCRIPTION_URL as string | undefined)?.trim() ||
      "https://apps.apple.com/account/subscriptions",
    /** Optional sponsored partner slot in the Basic status panel (partner URL). */
    partnerAdUrl: (import.meta.env.VITE_PARTNER_AD_URL as string | undefined)?.trim() ?? "",
    /**
     * Optional JSON array of Basic-tier promo overrides/additions.
     * Example: `[{"id":"partner-sponsored","text":"…","href":"https://…","sponsored":true}]`
     */
    basicAdsJson: (import.meta.env.VITE_BASIC_ADS_JSON as string | undefined)?.trim() ?? "",
    /** AdMob banner unit id (iOS/Android). Omit to use Google test ads in native dev builds. */
    admobBannerUnitId: (import.meta.env.VITE_ADMOB_BANNER_UNIT_ID as string | undefined)?.trim() ?? "",
    /** When true, AdMob serves test creatives on device (set in `.env.local` for QA). */
    admobTestMode: String(import.meta.env.VITE_ADMOB_TEST_MODE ?? "").toLowerCase() === "true",
    /**
     * RevenueCat iOS API key (`appl_...`). Empty = the SDK stays uninitialized and the
     * Subscription panel falls back to the legacy `upgradeUrl` link. See
     * `src/billing/revenueCat.ts` header for the dashboard + App Store Connect setup steps.
     */
    revenueCatApiKeyIos:
      (import.meta.env.VITE_REVENUECAT_API_KEY_IOS as string | undefined)?.trim() ?? "",
    /** Opt-in Mapbox Map Matching while navigating (`VITE_MAP_MATCHING_ENABLED=true`). */
    mapMatchingEnabled:
      String(import.meta.env.VITE_MAP_MATCHING_ENABLED ?? "").toLowerCase() === "true",
  };
}
