/**
 * NWS HTTP: resolve `https://api.weather.gov` on native (no Vite proxy).
 * Uses {@link CapacitorHttp.request} on iOS/Android only — do **not** rely on global `fetch` patching
 * (`CapacitorHttp.enabled`) here; that patch can interfere with Mapbox and other SDKs.
 */
import { Capacitor, CapacitorHttp } from "@capacitor/core";

export const NWS_HTTP_DEFAULT_TIMEOUT_MS = 22_000;

export function resolveNwsRequestUrl(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  if (url.startsWith("/weather-gov")) {
    /**
     * Vite dev (`npm run dev`): keep same-origin `/weather-gov` so the dev-server proxy applies (see
     * `vite.config.ts`). Rewriting to `https://api.weather.gov` here makes the **browser** hit NWS
     * cross-origin — usually blocked by CORS — which is why TestFlight worked but localhost dev did not.
     *
     * Use `import.meta.env.DEV` as well as `!Capacitor.isNativePlatform()` so we never rely on a
     * single signal if Capacitor loads oddly in a desktop browser tab.
     *
     * Capacitor live-reload / native: rewrite to https for native HTTP or WKWebView fetch.
     */
    const useViteProxy = import.meta.env.DEV && !Capacitor.isNativePlatform();
    if (useViteProxy) return url;
    return `https://api.weather.gov${url.slice("/weather-gov".length)}`;
  }
  if (typeof window !== "undefined" && url.startsWith("/")) {
    return `${window.location.origin}${url}`;
  }
  return url;
}

function httpResponseFromCapacitor(hr: {
  data: unknown;
  status: number;
  headers: Record<string, string>;
}): Response {
  const body =
    typeof hr.data === "string"
      ? hr.data
      : hr.data != null
        ? JSON.stringify(hr.data)
        : "";
  const rh = hr.headers && typeof hr.headers === "object" ? hr.headers : {};
  return new Response(body, {
    status: hr.status,
    headers: new Headers(rh as Record<string, string>),
  });
}

export async function nwsHttpGet(
  url: string,
  headers: Record<string, string>,
  options?: {
    signal?: AbortSignal;
    connectTimeout?: number;
    readTimeout?: number;
  }
): Promise<Response> {
  const connectTimeout = options?.connectTimeout ?? NWS_HTTP_DEFAULT_TIMEOUT_MS;
  const readTimeout = options?.readTimeout ?? NWS_HTTP_DEFAULT_TIMEOUT_MS;
  const resolved = resolveNwsRequestUrl(url);

  if (!Capacitor.isNativePlatform()) {
    return fetch(resolved, { headers, signal: options?.signal });
  }

  try {
    const hr = await CapacitorHttp.request({
      url: resolved,
      method: "GET",
      headers,
      connectTimeout,
      readTimeout,
      responseType: "text",
    });
    return httpResponseFromCapacitor(hr);
  } catch (first) {
    try {
      return await fetch(resolved, { headers, signal: options?.signal });
    } catch {
      throw first;
    }
  }
}
