/**
 * Headers for api.weather.gov from the browser or Capacitor WKWebView.
 *
 * NWS CORS: `Access-Control-Allow-Headers` is only `API-Key, User-Agent`. A custom
 * `Accept` (e.g. `application/geo+json, application/json`) triggers a preflight that
 * requests the `accept` header, which NWS does not list — the browser blocks the
 * request (TypeError / "Failed to fetch"). The Vite dev proxy is same-origin, so
 * CORS does not apply there; TestFlight and any direct `https://api.weather.gov`
 * call hit this.
 *
 * Omit `Accept`; NWS still returns JSON/GeoJSON for these endpoints.
 */
export function nwsApiRequestHeaders(userAgent: string): Record<string, string> {
  return { "User-Agent": userAgent };
}
