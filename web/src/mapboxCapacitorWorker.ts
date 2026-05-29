/**
 * Capacitor iOS (capacitor://localhost) rejects Mapbox's default blob: workers — tiles never
 * decode and WebKit throws `import.meta is only valid inside modules` on the blob worker.
 * Production builds alias `mapbox-gl` → mapbox-gl-csp (vite.config.ts); this sets workerUrl to
 * a hashed same-origin /assets/ file before any `new mapboxgl.Map()`.
 */
import mapboxgl from "mapbox-gl";
import mapboxWorkerUrl from "mapbox-gl/dist/mapbox-gl-csp-worker.js?url";

if (import.meta.env.PROD) {
  (mapboxgl as unknown as { workerUrl: string }).workerUrl = mapboxWorkerUrl;
}

export default mapboxgl;
