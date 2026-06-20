import type { LngLat } from "./types";
import type {
  RouteGeometryWorkerRequest,
  RouteGeometryWorkerResponse,
} from "./routeGeometryWorker";
import { buildCumulativeDistances } from "./routeGeometry";

/** Offload cumulative-distance builds for long polylines (windowed closest-point searches). */
export const ROUTE_GEOMETRY_WORKER_MIN_VERTICES = 800;

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<
  number,
  { resolve: (v: Float64Array) => void; reject: (e: Error) => void }
>();

function getWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./routeGeometryWorker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (ev: MessageEvent<RouteGeometryWorkerResponse>) => {
      const msg = ev.data;
      const slot = pending.get(msg.id);
      if (!slot) return;
      pending.delete(msg.id);
      if (msg.type === "buildCumulativeDistances") {
        slot.resolve(new Float64Array(msg.cumDist));
      }
    };
    worker.onerror = () => {
      for (const [, slot] of pending) {
        slot.reject(new Error("route geometry worker failed"));
      }
      pending.clear();
      worker = null;
    };
    return worker;
  } catch {
    return null;
  }
}

/**
 * Builds cumulative distances on a worker when the polyline is long enough; otherwise sync.
 * Falls back to the main thread if workers are unavailable.
 */
export function buildCumulativeDistancesAsync(geometry: LngLat[]): Promise<Float64Array> {
  if (geometry.length < 2) return Promise.resolve(new Float64Array(0));
  if (geometry.length < ROUTE_GEOMETRY_WORKER_MIN_VERTICES) {
    return Promise.resolve(buildCumulativeDistances(geometry));
  }
  const w = getWorker();
  if (!w) return Promise.resolve(buildCumulativeDistances(geometry));

  const id = nextId++;
  const payload: RouteGeometryWorkerRequest = { id, type: "buildCumulativeDistances", geometry };
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage(payload);
  });
}

/** Immediate sync build — used as a first-frame fallback before the worker responds. */
export { buildCumulativeDistances };
