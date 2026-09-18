/**
 * Progress-rail radar slice — the same colors as the map mosaic, where echo
 * actually crosses the corridor. Not the indigo advisory bands.
 *
 * Samples are { t: 0..1 along route, intensity: 0..1 mosaic }. We only paint
 * when a cell is on the line; a graze stays a short tick, not a padded mile.
 */

export type RadarSliceSample = { t: number; intensity: number };

/** Below this, the map tile is effectively clear — do not tint the rail. */
export const RADAR_SLICE_MIN_RAW = 0.1;

/**
 * RainViewer / NEXRAD-ish stops so a red pixel on the map is red on the rail.
 * Uses raw mosaic intensity (not the damped advisory curve).
 */
export function radarMapSliceHex(raw: number): string | null {
  if (!Number.isFinite(raw) || raw < RADAR_SLICE_MIN_RAW) return null;
  if (raw < 0.22) return "#22c55e";
  if (raw < 0.38) return "#a3e635";
  if (raw < 0.52) return "#facc15";
  if (raw < 0.68) return "#fb923c";
  if (raw < 0.82) return "#ef4444";
  if (raw < 0.92) return "#e879f9";
  return "#f8fafc";
}

function clamp01(t: number): number {
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.min(1, t));
}

/**
 * CSS linear-gradient along the rail (0% = start, 100% = dest).
 * Clear stretches stay transparent so the blue track shows through.
 */
export function radarRailSliceGradientCss(samples: RadarSliceSample[] | undefined | null): string | null {
  if (!samples?.length) return null;
  const sorted = [...samples]
    .filter((s) => Number.isFinite(s.t) && Number.isFinite(s.intensity))
    .sort((a, b) => a.t - b.t);
  if (!sorted.length) return null;

  const stops: string[] = [];
  const push = (t: number, color: string) => {
    stops.push(`${color} ${(clamp01(t) * 100).toFixed(1)}%`);
  };

  const first = sorted[0]!;
  const firstHex = radarMapSliceHex(first.intensity);
  if (first.t > 0.012) {
    push(0, "transparent");
    push(Math.max(0, first.t - 0.01), "transparent");
  }
  if (firstHex) push(first.t, firstHex);
  else push(first.t, "transparent");

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    const prevHex = radarMapSliceHex(prev.intensity);
    const curHex = radarMapSliceHex(cur.intensity);
    const mid = (prev.t + cur.t) / 2;
    if (prevHex && !curHex) {
      push(mid, prevHex);
      push(mid + 0.004, "transparent");
    } else if (!prevHex && curHex) {
      push(mid, "transparent");
      push(mid + 0.004, curHex);
    }
    if (curHex) push(cur.t, curHex);
    else push(cur.t, "transparent");
  }

  const last = sorted[sorted.length - 1]!;
  if (last.t < 0.988) {
    const lastHex = radarMapSliceHex(last.intensity);
    if (lastHex) {
      push(Math.min(1, last.t + 0.01), lastHex);
      push(Math.min(1, last.t + 0.02), "transparent");
    }
    push(1, "transparent");
  }

  if (!stops.some((s) => !s.startsWith("transparent"))) return null;
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

function intensityAtT(samples: RadarSliceSample[], t: number): number {
  if (!samples.length) return 0;
  const sorted = [...samples].sort((a, b) => a.t - b.t);
  if (t <= sorted[0]!.t) return sorted[0]!.intensity;
  const last = sorted[sorted.length - 1]!;
  if (t >= last.t) return last.intensity;
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1]!;
    const b = sorted[i]!;
    if (t <= b.t) {
      const span = b.t - a.t;
      const u = span > 1e-6 ? (t - a.t) / span : 0;
      return a.intensity + (b.intensity - a.intensity) * u;
    }
  }
  return last.intensity;
}

/**
 * Blend two corridor slices (same t grid preferred). Used between radar mosaic frames.
 */
export function lerpRadarSliceSamples(
  a: RadarSliceSample[],
  b: RadarSliceSample[],
  u: number
): RadarSliceSample[] {
  const t = Math.max(0, Math.min(1, u));
  const ts = new Set<number>();
  for (const s of a) ts.add(s.t);
  for (const s of b) ts.add(s.t);
  return [...ts]
    .sort((x, y) => x - y)
    .map((frac) => ({
      t: frac,
      intensity: intensityAtT(a, frac) * (1 - t) + intensityAtT(b, frac) * t,
    }));
}

/**
 * Play mosaic frames along the rail the same way the map loops radar.
 * `loopT` is 0..1 through one sweep (past → now).
 */
export function radarSliceAtLoopT(
  frames: RadarSliceSample[][] | undefined | null,
  loopT: number
): RadarSliceSample[] | null {
  if (!frames?.length) return null;
  if (frames.length === 1) return frames[0] ?? null;
  const n = frames.length;
  const x = ((loopT % 1) + 1) % 1;
  const f = x * (n - 1);
  const i = Math.min(n - 2, Math.floor(f));
  const u = f - i;
  const a = frames[i];
  const b = frames[i + 1];
  if (!a?.length) return b ?? null;
  if (!b?.length) return a;
  return lerpRadarSliceSamples(a, b, u);
}

/** Keep first + last, spread the rest — used to cap rail mosaic fetches. */
export function pickEvenSpacedItems<T>(items: T[], cap: number): T[] {
  if (cap < 1 || items.length <= cap) return items.slice();
  if (cap === 1) return [items[items.length - 1]!];
  const out: T[] = [];
  let last = -1;
  for (let i = 0; i < cap; i++) {
    const idx = Math.round((i / (cap - 1)) * (items.length - 1));
    if (idx === last) continue;
    last = idx;
    const item = items[idx];
    if (item !== undefined) out.push(item);
  }
  return out;
}

/** Max mosaic frames to sample for the moving rail (past → now). */
export const RADAR_RAIL_LOOP_FRAME_CAP = 5;

/** One rail sweep (past → now). Slower than the map overlay so the colors are readable. */
export const RADAR_RAIL_LOOP_MS = 6000;
