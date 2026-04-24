/**
 * api.weather.gov requires a descriptive User-Agent string identifying the app
 * plus a contact (URL or email).
 *
 * IMPORTANT: never hard-code a personal email address here — this file ships in
 * the client bundle and bots will harvest it. Set the contact through the
 * `VITE_WEATHER_ALERT_USER_AGENT` env var (Netlify → Site configuration →
 * Environment variables and `.env.local` for dev). Use a role address (e.g.
 * `support@yourdomain`) or a public URL.
 *
 * The default below uses a generic site URL so production never leaks PII even
 * if the env var is missing. If api.weather.gov starts to throttle you, supply
 * a real contact via the env var.
 */
const DEFAULT_NWS_USER_AGENT =
  "StormPath/1.0 (+https://stormpath.netlify.app/ contact via in-app About → Support)";

const fromEnv = (import.meta.env.VITE_WEATHER_ALERT_USER_AGENT as string | undefined)?.trim();

export const NWS_REQUEST_USER_AGENT = fromEnv || DEFAULT_NWS_USER_AGENT;
