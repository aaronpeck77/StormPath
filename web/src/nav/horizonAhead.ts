/** Incident kinds the native horizon walker is allowed to send. */
const HORIZON_HAZARD_KINDS = new Set([
  "construction",
  "lane_restriction",
  "road_closure",
  "accident",
  "congestion",
  "road_hazard",
  "disabled_vehicle",
  "weather",
  "planned_event",
]);

const KIND_NEEDLE: Record<string, string> = {
  construction: "construction",
  lane_restriction: "lane",
  road_closure: "closed",
  accident: "crash",
  congestion: "congestion",
  road_hazard: "hazard",
  disabled_vehicle: "stopped vehicle",
  weather: "weather on the road",
  planned_event: "planned",
};

export type HorizonHazard = {
  kind: string;
  text: string;
  distanceM: number;
};

/** Road-graph limit in mph. Unlimited and nonsense values stay blank. */
export function horizonLimitMph(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number.NaN;
  if (!Number.isFinite(n) || n < 10 || n > 95) return null;
  return Math.round(n);
}

export function horizonHazardsFromProgress(raw: unknown): HorizonHazard[] {
  if (!Array.isArray(raw)) return [];
  const out: HorizonHazard[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const kind = typeof rec.kind === "string" ? rec.kind : "";
    const text = typeof rec.text === "string" ? rec.text.replace(/\s+/g, " ").trim() : "";
    const distanceM = typeof rec.distanceM === "number" ? rec.distanceM : Number.NaN;
    if (!HORIZON_HAZARD_KINDS.has(kind) || !text) continue;
    if (!Number.isFinite(distanceM) || distanceM < 0 || distanceM > 10_000) continue;
    out.push({ kind, text, distanceM });
  }
  out.sort((a, b) => a.distanceM - b.distanceM);
  return out.slice(0, 4);
}

export function formatHorizonHazardLine(hazard: HorizonHazard, useMiles: boolean): string {
  if (hazard.distanceM < 80) return `${hazard.text}, on this road`;
  if (useMiles) {
    const miles = hazard.distanceM / 1609.344;
    const dist = miles < 10 ? `${miles.toFixed(1)} mi` : `${Math.round(miles)} mi`;
    return `${hazard.text}, ${dist} ahead`;
  }
  const km = hazard.distanceM / 1000;
  const dist = km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
  return `${hazard.text}, ${dist} ahead`;
}

/** Keep a storm line. Add the horizon hazard when the bar does not already say it. */
export function mergeHorizonHazardLine(
  existing: string | null,
  horizonLine: string,
  kind: string
): string {
  if (!existing) return horizonLine;
  const needle = KIND_NEEDLE[kind] ?? "";
  if (needle && existing.toLowerCase().includes(needle)) return existing;
  return `${horizonLine}. ${existing}`;
}
