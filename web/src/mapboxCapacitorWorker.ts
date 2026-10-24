/**
 * Capacitor iOS (capacitor://localhost) rejects Mapbox's default blob: workers — tiles never
 * decode and WebKit throws `import.meta is only valid inside modules` on the blob worker.
 * Production builds alias `mapbox-gl` → mapbox-gl-csp (vite.config.ts); this sets workerUrl to
 * a hashed same-origin /assets/ file before any `new mapboxgl.Map()`.
 */
import mapboxgl from "mapbox-gl";
import mapboxWorkerUrl from "mapbox-gl/dist/mapbox-gl-csp-worker.js?url";
import offlineWorkerUrl from "./map/mapboxOfflineWorker?worker&url";
import { wrapFetchWithOfflineTiles } from "./map/offlineTileCache";
import { recordMapboxUsage } from "./monitoring/mapboxUsageMeter";

if (import.meta.env.PROD) {
  /* Route GL's worker spawn through our wrapper script, which sets up the offline
   * tile fetch before importScripts loads the real csp-worker (?w=…). */
  (mapboxgl as unknown as { workerUrl: string }).workerUrl =
    `${offlineWorkerUrl}?w=${encodeURIComponent(new URL(mapboxWorkerUrl, location.href).href)}`;
}

/* Main-thread wrap: style JSON, sprites, and tilejson fetch on the window thread.
 * The URL filter guarantees only Mapbox map resources are touched — every other
 * fetch in the app passes straight through. Runs in dev and prod. */
if (typeof window !== "undefined" && !(window.fetch as { __stormpathOfflineTiles?: boolean }).__stormpathOfflineTiles) {
  const wrapped = wrapFetchWithOfflineTiles(window.fetch.bind(window)) as typeof fetch & {
    __stormpathOfflineTiles?: boolean;
  };
  wrapped.__stormpathOfflineTiles = true;
  window.fetch = wrapped;
}

/**
 * Mapbox GL JS bills by "map load" — once per `Map` object initialized, regardless of how
 * much panning/zooming/tile fetching happens afterward (docs.mapbox.com/mapbox-gl-js/guides/pricing).
 * Every map in the app (`DriveMap`, `PipMap`, `HazardPipMap`, `RouteOverviewPip`) imports
 * `mapboxgl` from this module and calls `new mapboxgl.Map(...)`, so subclassing here is the
 * single place that reliably counts every real load without touching each call site — and
 * without needing anything from Mapbox's account/statistics side, which has no public API.
 */
class TrackedMap extends mapboxgl.Map {
  constructor(options: mapboxgl.MapOptions) {
    super(options);
    recordMapboxUsage("mapLoads");
  }
}
(mapboxgl as unknown as { Map: typeof mapboxgl.Map }).Map = TrackedMap;

export default mapboxgl;
