import { useEffect, useMemo, useRef, useState } from "react";
import type { LngLat } from "../nav/types";
import {
  echoIntensityFromRgba,
  fetchRadarTileRgba,
  RADAR_MOSAIC_SAMPLE_ZOOM,
  tileXY,
} from "../services/radarPolylineIntensity";
import { fetchRainViewerRadarFrames, tileUrlFromHostAndPath } from "../services/rainViewerRadar";
import { pointAlongPolyline } from "../ui/geometryAlong";

type RadarSample = { t: number; intensity: number };

/**
 * Sample the RainViewer radar mosaic along a route polyline and convert it into coarse “cell intensity”
 * values per sample. This tracks what the radar overlay shows even when NWS warnings don’t exist.
 */
export function useRadarBandsAlongRoute(
  enabled: boolean,
  geometry: LngLat[] | undefined
): { samples: RadarSample[]; updatedAt: number | null } {
  const [state, setState] = useState<{ samples: RadarSample[]; updatedAt: number | null }>({
    samples: [],
    updatedAt: null,
  });

  const geomKey = useMemo(
    () =>
      geometry?.length ? `${geometry.length}|${geometry[0]?.[0]}|${geometry[0]?.[1]}|${geometry.at(-1)?.[0]}|${geometry.at(-1)?.[1]}` : "",
    [geometry]
  );
  const lastKeyRef = useRef("");

  useEffect(() => {
    if (!enabled || !geometry || geometry.length < 2) {
      setState({ samples: [], updatedAt: null });
      return;
    }
    let cancelled = false;

    const run = async () => {
      const k = geomKey;
      lastKeyRef.current = k;

      const pack = await fetchRainViewerRadarFrames({ includeNowcast: false });
      if (!pack?.frames.length) return;
      const frame = pack.frames[pack.frames.length - 1]!;
      const template = tileUrlFromHostAndPath(pack.host, frame.path);

      const ts = [0.05, 0.18, 0.3, 0.42, 0.54, 0.66, 0.78, 0.9];
      const pts = ts.map((t) => ({ t, lngLat: pointAlongPolyline(geometry, t) })).filter((x) => x.lngLat);

      const Z = RADAR_MOSAIC_SAMPLE_ZOOM;
      const tileToSamples = new Map<string, { t: number; px: number; py: number }[]>();
      for (const p of pts) {
        const [lng, lat] = p.lngLat as LngLat;
        const { x, y, px, py } = tileXY(lng, lat, Z);
        const key = `${Z}/${x}/${y}`;
        const arr = tileToSamples.get(key) ?? [];
        arr.push({ t: p.t, px, py });
        tileToSamples.set(key, arr);
      }

      const out: RadarSample[] = [];
      for (const [key, items] of tileToSamples) {
        if (cancelled) return;
        const [zStr, xStr, yStr] = key.split("/");
        const url = template.replace("{z}", zStr!).replace("{x}", xStr!).replace("{y}", yStr!);
        const rgba = await fetchRadarTileRgba(url);
        for (const it of items) {
          if (!rgba) {
            out.push({ t: it.t, intensity: 0 });
            continue;
          }
          const idx = (it.py * 256 + it.px) * 4;
          const intensity = echoIntensityFromRgba(
            rgba[idx] ?? 0,
            rgba[idx + 1] ?? 0,
            rgba[idx + 2] ?? 0,
            rgba[idx + 3] ?? 0
          );
          out.push({ t: it.t, intensity });
        }
      }

      if (cancelled) return;
      if (lastKeyRef.current !== geomKey) return;
      setState({ samples: out.sort((a, b) => a.t - b.t), updatedAt: Date.now() });
    };

    void run();
    const id = window.setInterval(run, 180_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [enabled, geometry, geomKey]);

  return state;
}
