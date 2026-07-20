import type { NavRoute, PostedSpeedSample } from "./types";

/** Mapbox Directions `maxspeed` annotation entry → mph, or null when unknown / unlimited. */
export function mapboxMaxSpeedToMph(entry: unknown): number | null {
  if (entry == null) return null;
  if (typeof entry === "string") {
    if (entry === "unknown" || entry === "none") return null;
    return null;
  }
  if (typeof entry !== "object") return null;
  const o = entry as { speed?: unknown; unit?: unknown; unlimited?: unknown };
  if (o.unlimited === true) return null;
  const speed = o.speed;
  if (typeof speed !== "number" || !Number.isFinite(speed) || speed <= 0) return null;
  const unit = typeof o.unit === "string" ? o.unit.toLowerCase() : "";
  if (unit === "mph" || unit === "mi/h") return Math.round(speed);
  if (unit === "km/h" || unit === "kph") return Math.round(speed * 0.621371);
  /* Missing unit is ambiguous (mph vs km/h) — never guess; wrong Lim invites liability. */
  return null;
}

/** Posted limit at `alongMeters` from Mapbox samples (null when data missing). */
export function postedSpeedMphAt(
  route: Pick<NavRoute, "postedSpeedSamples"> | undefined,
  alongMeters: number
): number | null {
  const samples = route?.postedSpeedSamples;
  if (!samples?.length) return null;
  if (alongMeters <= samples[0]!.alongMeters) return samples[0]!.mph;
  let lo = 0;
  let hi = samples.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (samples[mid]!.alongMeters <= alongMeters) lo = mid;
    else hi = mid - 1;
  }
  return samples[lo]!.mph;
}

/** Collapse consecutive identical limits (keeps first alongM per run). */
export function dedupePostedSpeedSamples(samples: PostedSpeedSample[]): PostedSpeedSample[] {
  const out: PostedSpeedSample[] = [];
  for (const s of samples) {
    const prev = out[out.length - 1];
    if (prev && prev.mph === s.mph) continue;
    out.push(s);
  }
  return out;
}
