import { useEffect, useMemo, useRef, useState } from "react";
import type { LngLat } from "../nav/types";
import {
  echoIntensityFromPrecipTile,
  echoIntensityFromRgba,
  RADAR_MOSAIC_SAMPLE_ZOOM,
  RADAR_ROUTE_SAMPLE_FRACTIONS,
  tileXY,
} from "../services/radarPolylineIntensity";
import { fetchMapTileRgba } from "../services/rainViewerTileFetch";
import {
  nearestRadarFrameByTimeMs,
  radarMapProviderForCenter,
  radarTileUrlForFrame,
  resolveRadarMapPack,
  type RadarMapFrame,
} from "../services/radarMapPack";
import { isRainViewerRateLimited } from "../services/rainViewerTileFetch";
import { buildCumulativeDistances, pointAtAlongMeters, polylineLengthMeters } from "../nav/routeGeometry";

type RadarSample = { t: number; intensity: number };

/**
 * Sample the radar mosaic along a route polyline and convert it into coarse "cell intensity"
 * values per sample. Uses the same fractions as route scoring ({@link RADAR_ROUTE_SAMPLE_FRACTIONS}).
 *
 * Map overlay provider split: US → Tomorrow.io when keyed, elsewhere RainViewer. This hook uses the
 * same split for short trips. On longer trips (ETA &gt; 5 min) it always uses RainViewer **nowcast**
 * frames so each sample can reflect where echoes are modeled when you arrive — even on US routes.
 */
export function useRadarBandsAlongRoute(
  enabled: boolean,
  geometry: LngLat[] | undefined,
  pollIntervalMs = 300_000,
  /** Trip ETA in minutes. When provided, each sample uses the frame nearest its arrival time. */
  planEtaMinutes?: number | null,
  tomorrowIoApiKey?: string | null
): { samples: RadarSample[]; updatedAt: number | null } {
  const [state, setState] = useState<{ samples: RadarSample[]; updatedAt: number | null }>({
    samples: [],
    updatedAt: null,
  });

  const geomKey = useMemo(
    () =>
      geometry?.length
        ? `${geometry.length}|${geometry[0]?.[0]}|${geometry[0]?.[1]}|${geometry.at(-1)?.[0]}|${geometry.at(-1)?.[1]}`
        : "",
    [geometry]
  );
  const routeCenter = useMemo((): LngLat | null => {
    if (!geometry?.length) return null;
    return geometry[Math.floor(geometry.length / 2)]!;
  }, [geometry]);
  const lastKeyRef = useRef("");

  // Bucket ETA to 5-min intervals so minor GPS drift doesn't re-trigger the effect.
  const etaKey = planEtaMinutes != null && planEtaMinutes > 5 ? Math.round(planEtaMinutes / 5) : 0;

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log(`[radarRoute] enabled=${enabled} geomPts=${geometry?.length ?? 0} eta=${planEtaMinutes ?? "none"}`);
    }
    if (!enabled || !geometry || geometry.length < 2 || !routeCenter) {
      setState({ samples: [], updatedAt: null });
      return;
    }
    let cancelled = false;

    const run = async () => {
      const useEta = planEtaMinutes != null && planEtaMinutes > 5;
      const mapProvider = radarMapProviderForCenter(routeCenter, tomorrowIoApiKey);
      const stripUsesRainViewer = useEta || mapProvider === "rainviewer";
      if (stripUsesRainViewer && isRainViewerRateLimited()) return;
      lastKeyRef.current = geomKey;

      const pack = await resolveRadarMapPack(routeCenter, tomorrowIoApiKey, {
        includeNowcast: useEta,
        forceRainViewer: useEta,
      });
      if (!pack?.frames.length) return;

      const now = Date.now();
      const totalM = polylineLengthMeters(geometry);
      const cumDist = buildCumulativeDistances(geometry);

      const pts = RADAR_ROUTE_SAMPLE_FRACTIONS.map((t) => {
        const targetMs = useEta ? now + t * (planEtaMinutes ?? 0) * 60_000 : now;
        return {
          t,
          lngLat: pointAtAlongMeters(geometry, totalM * t, cumDist),
          frame: nearestRadarFrameByTimeMs(pack.frames, targetMs),
        };
      });
      if (import.meta.env.DEV) {
        const oldest = Math.min(...pack.frames.map((f) => f.time));
        const newest = Math.max(...pack.frames.map((f) => f.time));
        const etaTargetMin = Math.round(((planEtaMinutes ?? 0) * 60_000) / 60_000);
        console.log(
          `[radarRoute] provider=${pack.provider} frames=${pack.frames.length} oldest=${new Date(oldest * 1000).toLocaleTimeString()} newest=${new Date(newest * 1000).toLocaleTimeString()} useEta=${useEta} etaMin=${etaTargetMin}`
        );
      }

      type SampleRef = { t: number; px: number; py: number };
      const groups = new Map<string, { frame: RadarMapFrame; tileKey: string; samples: SampleRef[] }>();
      const Z = RADAR_MOSAIC_SAMPLE_ZOOM;

      for (const p of pts) {
        const [lng, lat] = p.lngLat as LngLat;
        const { x, y, px, py } = tileXY(lng, lat, Z);
        const tileKey = `${Z}/${x}/${y}`;
        const groupId = `${p.frame.path}|${tileKey}`;
        const existing = groups.get(groupId);
        if (existing) {
          existing.samples.push({ t: p.t, px, py });
        } else {
          groups.set(groupId, {
            frame: p.frame,
            tileKey,
            samples: [{ t: p.t, px, py }],
          });
        }
      }

      const intensityFromRgba =
        pack.provider === "tomorrow_io" ? echoIntensityFromPrecipTile : echoIntensityFromRgba;
      const tileProvider = pack.provider === "tomorrow_io" ? "tomorrow_io" : "rainviewer";

      const out: RadarSample[] = [];
      for (const { frame, tileKey, samples } of groups.values()) {
        if (cancelled) return;
        const template = radarTileUrlForFrame(pack, frame, tomorrowIoApiKey);
        if (!template) {
          for (const it of samples) out.push({ t: it.t, intensity: 0 });
          continue;
        }
        const [zStr, xStr, yStr] = tileKey.split("/");
        const url = template
          .replace("{z}", zStr!)
          .replace("{x}", xStr!)
          .replace("{y}", yStr!);
        const rgba = await fetchMapTileRgba(url, tileProvider);
        for (const it of samples) {
          if (!rgba) {
            out.push({ t: it.t, intensity: 0 });
            continue;
          }
          const idx = (it.py * 256 + it.px) * 4;
          const intensity = intensityFromRgba(
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
      if (import.meta.env.DEV) {
        const maxI = out.length ? Math.max(...out.map((s) => s.intensity)) : 0;
        console.log(`[radarRoute] samples=${out.length} maxIntensity=${maxI.toFixed(3)}`);
      }
      setState({ samples: out.sort((a, b) => a.t - b.t), updatedAt: Date.now() });
    };

    void run();
    const id = window.setInterval(run, pollIntervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  // etaKey instead of planEtaMinutes to avoid constant re-runs on live ETA jitter
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, geometry, geomKey, pollIntervalMs, etaKey, routeCenter, tomorrowIoApiKey]);

  return state;
}
