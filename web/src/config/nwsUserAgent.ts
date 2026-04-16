/**
 * api.weather.gov requires a descriptive User-Agent: application name + contact (URL or email).
 * Edit the default string below before shipping. Optional: set VITE_WEATHER_ALERT_USER_AGENT in
 * `.env.local` to override without changing this file.
 */
const DEFAULT_NWS_USER_AGENT = "StormPath/1.0 (aaronpeck77@yahoo.com)";

const fromEnv = (import.meta.env.VITE_WEATHER_ALERT_USER_AGENT as string | undefined)?.trim();

export const NWS_REQUEST_USER_AGENT = fromEnv || DEFAULT_NWS_USER_AGENT;
