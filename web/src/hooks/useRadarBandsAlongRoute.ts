import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LngLat } from "../nav/types";
import {
  echoIntensityFromPrecipTile,
  echoIntensityFromRgba,
  RADAR_MOSAIC_SAMPLE_ZOOM,
  RADAR_ROUTE_SAMPLE_FRACTIONS,
  tileXY,
} from "../services/radarPolylineIntensity";
import { fetchMapTileRgba, isRainViewerRateLimited } from "../services/rainViewerTileFetch";
import {
  nearestRadarFrameByTimeMs,
  radarMapProviderForCenter,
  radarTileUrlForFrame,
  resolveRadarMapPack,
  type RadarMapFrame,
} from "../services/radarMapPack";
import { buildCumulativeDistances, pointAtAlongMeters, polylineLengthMeters } from "../nav/routeGeometry";

export type RadarSample = { t: number; intensity: number };

export type RadarBandsAlongRouteState = {
  samples: RadarSample[];
  updatedAt: number | null;
  /** Set when RainViewer rate-limits — prior samples are kept. */
  refreshBlocked: string | null;
  refreshing: boolean;
  bumpRadarResample: () => void;
};

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
): RadarBandsAlongRouteState {
  const [state, setState] = useState<{
    samples: RadarSample[];
    updatedAt: number | null;
    refreshBlocked: string | null;
  }>({
    samples: [],
    updatedAt: null,
    refreshBlocked: null,
  });
  const [refreshTick, setRefreshTick] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

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
  const samplesRef = useRef<RadarSample[]>([]);
  samplesRef.current = state.samples;

  // Bucket ETA to 5-min intervals so minor GPS drift doesn't re-trigger the effect.
  const etaKey = planEtaMinutes != null && planEtaMinutes > 5 ? Math.round(planEtaMinutes / 5) : 0;

  const bumpRadarResample = useCallback(() => {
    setRefreshTick((n) => n + 1);
    setRefreshing(true);
  }, []);

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log(`[radarRoute] enabled=${enabled} geomPts=${geometry?.length ?? 0} eta=${planEtaMinutes ?? "none"}`);
    }
    if (!geometry || geometry.length < 2 || !routeCenter || !geomKey) {
      setState({ samples: [], updatedAt: null, refreshBlocked: null });
      setRefreshing(false);
      return;
    }
    if (!enabled) {
      /* Keep last samples when briefly disabled (e.g. Drive with Route Info closed). */
      setRefreshing(false);
      return;
    }
    let cancelled = false;

    const run = async () => {
      const useEta = planEtaMinutes != null && planEtaMinutes > 5;
      const mapProvider = radarMapProviderForCenter(routeCenter, tomorrowIoApiKey);
      const stripUsesRainViewer = useEta || mapProvider === "rainviewer";
      if (stripUsesRainViewer && isRainViewerRateLimited()) {
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            refreshBlocked: "Radar paused — rate limited. Try again in a few minutes.",
          }));
          setRefreshing(false);
        }
        return;
      }
      lastKeyRef.current = geomKey;

      const pack = await resolveRadarMapPack(routeCenter, tomorrowIoApiKey, {
        includeNowcast: useEta,
        forceRainViewer: useEta,
        /* Intensity sampling can use TIO precip tiles; map overlay stays on RainViewer. */
        allowTomorrowIoMapTiles: !useEta,
      });
      if (!pack?.frames.length) {
        if (!cancelled) setRefreshing(false);
        return;
      }

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
        const template = radarTileUrlForFrame(pack, frame, tomorrowIoApiKey, "sample");
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
      setState({
        samples: out.sort((a, b) => a.t - b.t),
        updatedAt: Date.now(),
        refreshBlocked: null,
      });
      setRefreshing(false);
    };

    void run();
    const id = window.setInterval(run, pollIntervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  // etaKey instead of planEtaMinutes to avoid constant re-runs on live ETA jitter
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, geometry, geomKey, pollIntervalMs, etaKey, routeCenter, tomorrowIoApiKey, refreshTick]);

  return {
    samples: state.samples,
    updatedAt: state.updatedAt,
    refreshBlocked: state.refreshBlocked,
    refreshing,
    bumpRadarResample,
  };
}

/** Human-readable age for Route Info radar status (e.g. "Radar · 3 min ago"). */
export function formatRadarSampleAge(updatedAt: number | null, nowMs = Date.now()): string | null {
  if (updatedAt == null || !Number.isFinite(updatedAt)) return null;
  const ageSec = Math.max(0, Math.round((nowMs - updatedAt) / 1000));
  if (ageSec < 45) return "Radar · just now";
  if (ageSec < 90) return "Radar · 1 min ago";
  const ageMin = Math.round(ageSec / 60);
  if (ageMin < 60) return `Radar · ${ageMin} min ago`;
  const ageHr = Math.round(ageMin / 60);
  return `Radar · ${ageHr} hr ago`;
}
