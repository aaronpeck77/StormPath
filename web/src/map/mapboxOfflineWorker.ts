import { wrapFetchWithOfflineTiles } from "./offlineTileCache";

/**
 * Offline-tiles wrapper around the stock mapbox-gl-csp worker.
 *
 * GL spawns its worker from `mapboxgl.workerUrl`. We point that at THIS script with
 * the real csp-worker URL in the `?w=` query param, wrap the worker-global `fetch`
 * before the Mapbox code loads (its vector-tile / glyph requests resolve through the
 * global), then pull the real worker in with `importScripts`. The worker must be
 * emitted as a classic script (`worker.format = "iife"` in vite.config.ts) —
 * `importScripts` does not exist in module workers.
 */

const workerScope = self as unknown as {
  fetch: typeof fetch;
  location: Location;
  importScripts: (...urls: string[]) => void;
};

workerScope.fetch = wrapFetchWithOfflineTiles(workerScope.fetch.bind(workerScope));

const workerUrl = new URLSearchParams(workerScope.location.search).get("w");
if (workerUrl) {
  workerScope.importScripts(workerUrl);
}
