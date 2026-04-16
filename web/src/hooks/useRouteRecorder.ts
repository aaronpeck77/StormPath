import { useCallback, useRef, useState } from "react";
import { haversineMeters, polylineLengthMeters } from "../nav/routeGeometry";
import type { LngLat } from "../nav/types";

/** Ignore GPS jitter: only append when this far from last sample (meters). */
const MIN_STEP_M = 12;
/** Minimum path to allow saving (~150 ft). */
export const MIN_RECORD_PATH_M = 46;
/** Minimum vertices after thinning. */
const MIN_POINTS = 3;

export function useRouteRecorder() {
  const [active, setActive] = useState(false);
  const pointsRef = useRef<LngLat[]>([]);
  /** Copy of points for map preview (ref alone does not re-render). */
  const [pathPreview, setPathPreview] = useState<LngLat[]>([]);
  const [pointCount, setPointCount] = useState(0);
  const [lengthMeters, setLengthMeters] = useState(0);

  const discard = useCallback(() => {
    pointsRef.current = [];
    setPathPreview([]);
    setPointCount(0);
    setLengthMeters(0);
    setActive(false);
  }, []);

  const start = useCallback((seed: LngLat | null) => {
    pointsRef.current = seed ? [[seed[0]!, seed[1]!]] : [];
    setPathPreview([...pointsRef.current]);
    setPointCount(pointsRef.current.length);
    setLengthMeters(0);
    setActive(true);
  }, []);

  const ingest = useCallback(
    (p: LngLat) => {
      if (!active) return;
      const list = pointsRef.current;
      const last = list[list.length - 1];
      if (last && haversineMeters(last, p) < MIN_STEP_M) return;
      list.push([p[0]!, p[1]!]);
      setPointCount(list.length);
      setLengthMeters(polylineLengthMeters(list));
      setPathPreview([...list]);
    },
    [active]
  );

  /**
   * If the path is long enough, ends recording and returns the polyline.
   * If too short, returns null and **keeps** recording so you can drive farther.
   */
  const tryFinishRecording = useCallback((): LngLat[] | null => {
    const pts = pointsRef.current;
    const len = polylineLengthMeters(pts);
    if (pts.length < MIN_POINTS || len < MIN_RECORD_PATH_M) return null;
    pointsRef.current = [];
    setPathPreview([]);
    setPointCount(0);
    setLengthMeters(0);
    setActive(false);
    return pts.map(([a, b]) => [a, b] as LngLat);
  }, []);

  return {
    active,
    pointCount,
    lengthMeters,
    pathPreview,
    start,
    ingest,
    discard,
    tryFinishRecording,
  };
}
