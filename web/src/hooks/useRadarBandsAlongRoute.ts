import { useEffect, useMemo, useRef, useState } from "react";
import type { LngLat } from "../nav/types";
import {
  echoIntensityFromRgba,
  fetchRadarTileRgba,
  RADAR_MOSAIC_SAMPLE_ZOOM,
  RADAR_ROUTE_SAMPLE_FRACTIONS,
  tileXY,
} from "../services/radarPolylineIntensity";
import {
  fetchRainViewerRadarFrames,
  tileUrlFromHostAndPath,
  type RainViewerRadarFrame,
} from "../services/rainViewerRadar";
import { isRainViewerRateLimited } from "../services/rainViewerTileFetch";
import { buildCumulativeDistances, pointAtAlongMeters, polylineLengthMeters } from "../nav/routeGeometry";

type RadarSample = { t: number; intensity: number };

/** Pick the frame whose timestamp (seconds epoch) is nearest to a target epoch (ms). */
function nearestFrameByTime(
  frames: RainViewerRadarFrame[],
  targetMs: number
): RainViewerRadarFrame {
  let best = frames[0]!;
  let bestDiff = Math.abs(best.time * 1000 - targetMs);
  for (const f of frames) {
    const diff = Math.abs(f.time * 1000 - targetMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = f;
    }
  }
  return best;
}

/**
 * Sample the RainViewer radar mosaic along a route polyline and convert it into coarse "cell intensity"
 * values per sample. Uses the same fractions as route scoring ({@link RADAR_ROUTE_SAMPLE_FRACTIONS}).
 *
 * When `planEtaMinutes` is provided, uses RainViewer nowcast frames (radar motion extrapolation, ~1 hr
 * ahead) so each sample reflects **where the storm will be when the driver arrives** at that point —
 * not where it is right now. This is ETA-synced radar: the biggest practical improvement for "will it
 * be raining when I get there."
 */
export function useRadarBandsAlongRoute(
  enabled: boolean,
  geometry: LngLat[] | undefined,
  pollIntervalMs = 300_000,
  /** Trip ETA in minutes. When provided, each sample uses the nowcast frame nearest its arrival time. */
  planEtaMinutes?: number | null
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
  const lastKeyRef = useRef("");

  // Bucket ETA to 5-min intervals so minor GPS drift doesn't re-trigger the effect.
  const etaKey = planEtaMinutes != null && planEtaMinutes > 5 ? Math.round(planEtaMinutes / 5) : 0;

  useEffect(() => {
    if (!enabled || !geometry || geometry.length < 2) {
      setState({ samples: [], updatedAt: null });
      return;
    }
    let cancelled = false;

    const run = async () => {
      if (isRainViewerRateLimited()) return;
      lastKeyRef.current = geomKey;

      const useEta = planEtaMinutes != null && planEtaMinutes > 5;
      const pack = await fetchRainViewerRadarFrames({ includeNowcast: useEta });
      if (!pack?.frames.length) return;

      const now = Date.now();
      const totalM = polylineLengthMeters(geometry);
      const cumDist = buildCumulativeDistances(geometry);

      // Each sample point knows which frame timestamp to read — its arrival time.
      const pts = RADAR_ROUTE_SAMPLE_FRACTIONS.map((t) => {
        const targetMs = useEta ? now + t * (planEtaMinutes ?? 0) * 60_000 : now;
        return {
          t,
          lngLat: pointAtAlongMeters(geometry, totalM * t, cumDist),
          frame: nearestFrameByTime(pack.frames, targetMs),
        };
      });

      // Group by (framePath + tileKey) so any tile used by multiple samples is fetched once.
      type SampleRef = { t: number; px: number; py: number };
      const groups = new Map<string, { framePath: string; tileKey: string; samples: SampleRef[] }>();
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
            framePath: p.frame.path,
            tileKey,
            samples: [{ t: p.t, px, py }],
          });
        }
      }

      const out: RadarSample[] = [];
      for (const { framePath, tileKey, samples } of groups.values()) {
        if (cancelled) return;
        const template = tileUrlFromHostAndPath(pack.host, framePath);
        const [zStr, xStr, yStr] = tileKey.split("/");
        const url = template
          .replace("{z}", zStr!)
          .replace("{x}", xStr!)
          .replace("{y}", yStr!);
        const rgba = await fetchRadarTileRgba(url);
        for (const it of samples) {
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
    const id = window.setInterval(run, pollIntervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  // etaKey instead of planEtaMinutes to avoid constant re-runs on live ETA jitter
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, geometry, geomKey, pollIntervalMs, etaKey]);

  return state;
}
