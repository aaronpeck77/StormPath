import mapboxgl from "../mapboxCapacitorWorker";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef, useState } from "react";
import type { LngLat } from "../nav/types";
import {
  resolveRadarMapPack,
  radarTileUrlForFrame,
  type RadarMapPack,
} from "../services/radarMapPack";
import {
  ensureRainViewerRadarDual,
  setRainViewerRadarTilesOnSource,
  setRainViewerRadarDualOpacity,
  animateRainViewerDualCrossfade,
  waitForRainViewerSideLoaded,
  removeRainViewerRadar,
  radarAnimationCrossfadeMs,
  RAINVIEWER_RADAR_VISIBLE_OPACITY,
} from "./mapRadarLayer";

const RADAR_STYLE = "mapbox://styles/mapbox/dark-v11";
/** z6 shows a few hundred miles across — storm-region context, not street level. */
const COMPANION_RADAR_ZOOM = 6;
/** Fresh mosaics land ~every 10 min; re-resolve the pack on this cadence. */
const PACK_REFRESH_MS = 5 * 60_000;
/** Don't recenter on every GPS tick — only when the driver actually leaves the view. */
const RECENTER_THRESHOLD_DEG = 0.12;
const FRAME_SETTLE_MS = 2_400;

type RadarStatus = "loading" | "ok" | "unavailable";

type Props = {
  accessToken: string;
  tomorrowIoApiKey: string | null | undefined;
  /** Driver position — the box stays centered here. */
  userLngLat: LngLat | null;
  isOnline: boolean;
};

/**
 * Small non-interactive radar box for the CarPlay companion page — the car's
 * own radar overlay never loaded tiles, so storm awareness while driving
 * CarPlay lives here instead. Dual-buffer crossfade loop reuses the same
 * primitives as the main DriveMap radar, minus traffic-layer bookkeeping
 * (this map has no other custom layers).
 */
export function CompanionRadarMap({ accessToken, tomorrowIoApiKey, userLngLat, isOnline }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const lastCenterRef = useRef<LngLat | null>(null);
  const [status, setStatus] = useState<RadarStatus>("loading");

  /* Map create/destroy — once per mount. */
  useEffect(() => {
    if (!wrapRef.current || mapRef.current) return;
    mapboxgl.accessToken = accessToken;
    const center = userLngLat ?? [-98.5, 39.8];
    const map = new mapboxgl.Map({
      container: wrapRef.current,
      style: RADAR_STYLE,
      center,
      zoom: COMPANION_RADAR_ZOOM,
      pitch: 0,
      bearing: 0,
      interactive: false,
      attributionControl: false,
      fadeDuration: 0,
    });
    lastCenterRef.current = center;
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    /* eslint-disable-next-line react-hooks/exhaustive-deps -- center tracked separately */
  }, [accessToken]);

  /* Follow the driver — jump only when they leave the regional view. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !userLngLat) return;
    const last = lastCenterRef.current;
    const moved =
      !last ||
      Math.abs(userLngLat[0] - last[0]) > RECENTER_THRESHOLD_DEG ||
      Math.abs(userLngLat[1] - last[1]) > RECENTER_THRESHOLD_DEG;
    if (!moved) return;
    lastCenterRef.current = userLngLat;
    try {
      map.jumpTo({ center: userLngLat, zoom: COMPANION_RADAR_ZOOM, pitch: 0, bearing: 0 });
    } catch {
      /* style race */
    }
  }, [userLngLat]);

  /* Radar pack + animation loop. Re-runs when connectivity flips; the pack
   * itself re-resolves on a timer inside the loop. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isOnline) {
      if (!isOnline) setStatus("unavailable");
      return;
    }
    let cancelled = false;
    let generation = 0;

    const runLoop = async (gen: number) => {
      const alive = () => !cancelled && gen === generation && mapRef.current === map;
      setStatus((s) => (s === "ok" ? s : "loading"));
      const pack = await resolveRadarMapPack(lastCenterRef.current, tomorrowIoApiKey, {
        mapAnimation: true,
      });
      if (!alive()) return;
      const frames = pack?.frames.filter((f) => radarTileUrlForFrame(pack as RadarMapPack, f, tomorrowIoApiKey)) ?? [];
      if (!pack || frames.length === 0) {
        setStatus("unavailable");
        return;
      }
      const firstUrl = radarTileUrlForFrame(pack, frames[0]!, tomorrowIoApiKey);
      try {
        ensureRainViewerRadarDual(map, firstUrl, RAINVIEWER_RADAR_VISIBLE_OPACITY, {
          maxZoom: pack.maxZoom,
          attribution: pack.attribution,
          recreate: true,
        });
      } catch {
        /* style not ready yet — retry on next refresh tick */
        return;
      }
      setStatus("ok");

      const opacity = RAINVIEWER_RADAR_VISIBLE_OPACITY;
      const crossfadeMs = radarAnimationCrossfadeMs(frames.length);
      let visible: "a" | "b" = "a";
      let idx = 0;
      setRainViewerRadarTilesOnSource(map, "a", firstUrl, 0);
      setRainViewerRadarDualOpacity(map, opacity, 0);

      if (frames.length > 1) {
        while (alive()) {
          const nextIdx = (idx + 1) % frames.length;
          const hidden: "a" | "b" = visible === "a" ? "b" : "a";
          setRainViewerRadarTilesOnSource(map, hidden, radarTileUrlForFrame(pack, frames[nextIdx]!, tomorrowIoApiKey));
          await waitForRainViewerSideLoaded(map, hidden, FRAME_SETTLE_MS);
          if (!alive()) return;
          const from = visible === "a" ? { a: opacity, b: 0 } : { a: 0, b: opacity };
          const to = visible === "a" ? { a: 0, b: opacity } : { a: opacity, b: 0 };
          await animateRainViewerDualCrossfade(map, from, to, crossfadeMs);
          if (!alive()) return;
          visible = hidden;
          idx = nextIdx;
        }
      }
    };

    let refreshTimer: number | null = null;
    const start = () => {
      if (cancelled) return;
      const g = ++generation;
      void runLoop(g);
      if (refreshTimer == null) {
        refreshTimer = window.setInterval(() => {
          if (cancelled) return;
          const g2 = ++generation;
          void runLoop(g2);
        }, PACK_REFRESH_MS);
      }
    };
    /* addSource throws before the style finishes loading — gate the first run
     * on it or the radar sits dead until the 5-min refresh. */
    if (map.isStyleLoaded()) start();
    else map.once("load", start);

    return () => {
      cancelled = true;
      generation += 1;
      map.off("load", start);
      if (refreshTimer != null) window.clearInterval(refreshTimer);
      try {
        removeRainViewerRadar(map);
      } catch {
        /* torn down */
      }
    };
  }, [isOnline, tomorrowIoApiKey]);

  return (
    <div className="cp-radar" aria-label="Nearby radar">
      <div ref={wrapRef} className="cp-radar__map" aria-hidden />
      {status !== "ok" ? (
        <div className="cp-radar__note" role="status">
          {status === "loading" ? "Loading radar…" : "Radar unavailable — no recent frames."}
        </div>
      ) : null}
    </div>
  );
}
