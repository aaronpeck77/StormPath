import { useEffect, useMemo, useRef, useState } from "react";
import type { LngLat } from "../nav/types";
import { fetchRainViewerRadarFrames, tileUrlFromHostAndPath } from "../services/rainViewerRadar";
import { pointAlongPolyline } from "../ui/geometryAlong";

type RadarSample = { t: number; intensity: number };

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function tileXY(lng: number, lat: number, z: number): { x: number; y: number; px: number; py: number } {
  const n = 2 ** z;
  const xFloat = ((lng + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const yFloat =
    (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n;
  const x = Math.floor(xFloat);
  const y = Math.floor(yFloat);
  const px = Math.max(0, Math.min(255, Math.floor((xFloat - x) * 256)));
  const py = Math.max(0, Math.min(255, Math.floor((yFloat - y) * 256)));
  return { x, y, px, py };
}

async function readTileRgba(url: string): Promise<Uint8ClampedArray | null> {
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) return null;
    const blob = await res.blob();
    const bmp = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0);
    const img = ctx.getImageData(0, 0, 256, 256);
    return img.data;
  } catch {
    return null;
  }
}

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

  const geomKey = useMemo(() => (geometry?.length ? `${geometry.length}|${geometry[0]?.[0]}|${geometry[0]?.[1]}|${geometry.at(-1)?.[0]}|${geometry.at(-1)?.[1]}` : ""), [geometry]);
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

      // Coarse sampling (enough to highlight big cells without hammering tile fetches).
      const ts = [0.05, 0.18, 0.3, 0.42, 0.54, 0.66, 0.78, 0.9];
      const pts = ts.map((t) => ({ t, lngLat: pointAlongPolyline(geometry, t) })).filter((x) => x.lngLat);

      // Group samples by tile so we fetch each tile once.
      const Z = 7;
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
        const url = template
          .replace("{z}", zStr!)
          .replace("{x}", xStr!)
          .replace("{y}", yStr!);
        const rgba = await readTileRgba(url);
        for (const it of items) {
          if (!rgba) {
            out.push({ t: it.t, intensity: 0 });
            continue;
          }
          const idx = (it.py * 256 + it.px) * 4;
          const r = rgba[idx] ?? 0;
          const g = rgba[idx + 1] ?? 0;
          const b = rgba[idx + 2] ?? 0;
          const a = rgba[idx + 3] ?? 0;
          // RainViewer uses colored pixels with alpha; transparent means “no precip”.
          // Use brightness as a crude proxy (good enough for “strong cell” indication).
          const bright = (r + g + b) / (3 * 255);
          const alpha = a / 255;
          out.push({ t: it.t, intensity: clamp01(bright * alpha * 1.35) });
        }
      }

      if (cancelled) return;
      // If route changed mid-fetch, discard.
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

