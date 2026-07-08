import { RADAR_ROUTE_SAMPLE_FRACTIONS } from "../../services/radarPolylineIntensity";

export type RadarSample = { t: number; intensity: number };

/** Piecewise-linear radar intensity at route fraction 0–1. */
export function radarIntensityAtFraction(samples: RadarSample[], fraction: number): number {
  if (!samples.length) return 0;
  const f = Math.max(0, Math.min(1, fraction));
  const sorted = [...samples].sort((a, b) => a.t - b.t);
  if (f <= sorted[0]!.t) return sorted[0]!.intensity;
  if (f >= sorted[sorted.length - 1]!.t) return sorted[sorted.length - 1]!.intensity;
  for (let i = 1; i < sorted.length; i++) {
    const hi = sorted[i]!;
    const lo = sorted[i - 1]!;
    if (f <= hi.t) {
      const span = hi.t - lo.t;
      if (span < 1e-6) return hi.intensity;
      const u = (f - lo.t) / span;
      return lo.intensity + u * (hi.intensity - lo.intensity);
    }
  }
  return sorted[sorted.length - 1]!.intensity;
}

/** Dense fractions for crossing search — radar hook samples + midpoints. */
export function denseRadarFractions(samples: RadarSample[]): number[] {
  const base = new Set<number>(RADAR_ROUTE_SAMPLE_FRACTIONS);
  for (const s of samples) base.add(s.t);
  const sorted = [...base].sort((a, b) => a - b);
  const dense: number[] = [];
  for (let i = 0; i < sorted.length; i++) {
    dense.push(sorted[i]!);
    const next = sorted[i + 1];
    if (next != null) dense.push((sorted[i]! + next) / 2);
  }
  return dense.sort((a, b) => a - b);
}
