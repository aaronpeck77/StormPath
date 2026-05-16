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
 *
 * Browser `fetch()` throws a TypeError if any header value contains a non-ISO-8859-1
 * code point, and Chrome overrides `User-Agent` regardless.  Skip the header in
 * non-native browser contexts — NWS accepts requests without it.
 */
export function nwsApiRequestHeaders(userAgent: string): Record<string, string> {
  // Capacitor native: CapacitorHttp.request() accepts User-Agent correctly.
  // Browser: User-Agent cannot be set via fetch() and Chrome throws on non-ASCII values.
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    return {};
  }
  return { "User-Agent": userAgent };
}
