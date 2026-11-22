import { nearestPointOnLine } from "@turf/nearest-point-on-line";
import { lineString, point } from "@turf/helpers";
import type { Feature, LineString } from "geojson";
import { isValidLngLatPair } from "./mapCameraSafe";
import { isPersonalForkRouteId } from "../personalForks/navRoute";
import { REJOIN_OVERLAY_ROUTE_ID } from "../nav/mergePlanRoutes";
import type { LngLat } from "../nav/types";

/**
 * DOT hazard-triangle placement — rebuilt pipeline (Nov 21).
 *
 * What ten rounds of "floating triangles" taught us:
 * - DOM markers cannot drift; the POSITIONS were wrong, not the renderer.
 * - Positions must come from the array the map paints — callers pass the
 *   paintedOut map captured inside applyRoutesToMap's own paint pass.
 * - When a focus leg is painted, prefer it over fit-across-all-legs so a
 *   leftover rejoin stub / fork preview cannot outbid the blue Main line
 *   (Guatemala column: probes from a stale match pick a N–S painted leftover).
 * - Synthetic legs still get a fit penalty when focus is absent.
 * - Each event still needs its own 400 m gate: events beyond the painted
 *   drive-slice window must drop, not pile at the slice tail.
 */

export type DotMarkerInput = {
  id: string;
  lngLat: LngLat;
  label: string;
  kind?: "construction" | "closure" | "incident" | "other";
};

export type DotMarkerPlacement = {
  /** Markers with positions snapped onto the winning painted leg. */
  markers: DotMarkerInput[];
  /** Painted leg id that won the fit, or null when nothing fit. */
  paintedId: string | null;
  /** Vertex count of the winning leg. */
  verts: number;
  /** Median probe lateral (m) on the winning leg — the fit score. */
  fitMedM: number | null;
  /** Painted legs considered (for diagnostics). */
  candidates: string[];
};

const MAX_LATERAL_M = 400;
/** Real corridors outbid synthetic stubs until the stub fits >250 m better. */
const SYNTHETIC_FIT_PENALTY_M = 250;
const PROBE_COUNT = 6;

function isSyntheticMarkerLeg(id: string): boolean {
  return id.startsWith(REJOIN_OVERLAY_ROUTE_ID) || isPersonalForkRouteId(id);
}

/* MINIMUM probe lateral, not median: events are ordered along the route, so
 * the first probes can legitimately sit beyond the painted drive-slice
 * window — a median reads them as "wrong corridor" and rejects the leg,
 * hiding every marker (caught by the out-of-window test). One event inside
 * a leg's window is decisive: events all matched the same corridor
 * upstream, so that leg IS theirs. The per-event 400m gate then drops the
 * out-of-window rest. */
function minLateralM(line: Feature<LineString>, pts: LngLat[]): number {
  let min = Number.POSITIVE_INFINITY;
  for (const p of pts) {
    const d =
      nearestPointOnLine(line, point(p), { units: "meters" }).properties
        ?.dist ?? Number.POSITIVE_INFINITY;
    if (d < min) min = d;
    if (min <= 1) break; // can't beat on-the-line
  }
  return min;
}

function snapMarkersToLine(
  line: Feature<LineString>,
  inputs: DotMarkerInput[]
): DotMarkerInput[] {
  return inputs.flatMap((m) => {
    const snap = nearestPointOnLine(line, point(m.lngLat), {
      units: "meters",
    });
    const lateralM = snap.properties?.dist ?? Number.POSITIVE_INFINITY;
    if (lateralM > MAX_LATERAL_M) return [];
    const c = snap.geometry.coordinates;
    return [{ ...m, lngLat: [c[0]!, c[1]!] as LngLat }];
  });
}

export function resolveDotMarkerPlacement(
  paintedLegs: ReadonlyMap<string, LngLat[]>,
  events: readonly DotMarkerInput[] | null | undefined,
  focusId?: string | null
): DotMarkerPlacement {
  const legs = [...paintedLegs.entries()].filter(
    ([, coords]) => coords.length >= 2
  );
  const inputs = (events ?? []).filter((m) => isValidLngLatPair(m.lngLat));
  const candidates = legs.map(([id]) => id);
  if (!legs.length || !inputs.length) {
    return { markers: [], paintedId: null, verts: 0, fitMedM: null, candidates };
  }

  const probes = inputs.slice(0, PROBE_COUNT).map((m) => m.lngLat);
  const focusKey = focusId?.trim() || null;
  const focusCoords = focusKey ? paintedLegs.get(focusKey) : undefined;

  /* Prefer the focused painted leg whenever it is on the map and within the
   * lateral gate. Fit-across-all-legs only runs when focus is missing or
   * too far (e.g. events still on a stale match before rematch settles). */
  if (focusCoords && focusCoords.length >= 2) {
    const focusLine = lineString(focusCoords);
    const focusMed = minLateralM(focusLine, probes);
    if (focusMed <= MAX_LATERAL_M) {
      return {
        markers: snapMarkersToLine(focusLine, inputs),
        paintedId: focusKey,
        verts: focusCoords.length,
        fitMedM: focusMed,
        candidates,
      };
    }
  }

  let best: {
    id: string;
    line: Feature<LineString>;
    med: number;
    score: number;
  } | null = null;
  for (const [id, coords] of legs) {
    const line = lineString(coords);
    const med = minLateralM(line, probes);
    const score = med + (isSyntheticMarkerLeg(id) ? SYNTHETIC_FIT_PENALTY_M : 0);
    if (!best || score < best.score) best = { id, line, med, score };
  }

  /* Nothing painted fits the corridor — hide rather than weld markers to
   * a wrong line. */
  if (!best || best.med > MAX_LATERAL_M) {
    return {
      markers: [],
      paintedId: null,
      verts: 0,
      fitMedM: best?.med ?? null,
      candidates,
    };
  }

  return {
    markers: snapMarkersToLine(best.line, inputs),
    paintedId: best.id,
    verts: best.line.geometry.coordinates.length,
    fitMedM: best.med,
    candidates,
  };
}
