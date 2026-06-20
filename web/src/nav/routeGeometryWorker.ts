import { buildCumulativeDistances } from "./routeGeometry";
import type { LngLat } from "./types";

export type RouteGeometryWorkerRequest =
  | { id: number; type: "buildCumulativeDistances"; geometry: LngLat[] };

export type RouteGeometryWorkerResponse =
  | { id: number; type: "buildCumulativeDistances"; cumDist: number[] };

self.onmessage = (ev: MessageEvent<RouteGeometryWorkerRequest>) => {
  const msg = ev.data;
  if (msg.type === "buildCumulativeDistances") {
    const cumDist = buildCumulativeDistances(msg.geometry);
    const payload: RouteGeometryWorkerResponse = {
      id: msg.id,
      type: "buildCumulativeDistances",
      cumDist: Array.from(cumDist),
    };
    self.postMessage(payload);
  }
};
