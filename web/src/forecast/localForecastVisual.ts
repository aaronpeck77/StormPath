/** Shared colors and thresholds for advisory local-forecast timelines. */

/** 0=N/A 1=rain 2=snow 3=freezing rain 4=ice/hail */
export type PrecipTypeCode = 0 | 1 | 2 | 3 | 4;

export function precipTypeFromLabel(type: string | undefined): PrecipTypeCode {
  const t = (type ?? "").toLowerCase();
  if (t.includes("snow")) return 2;
  if (t.includes("sleet") || t.includes("hail") || t.includes("ice pellet")) return 4;
  if (t.includes("freez")) return 3;
  if (t.includes("rain") || t.includes("drizzle") || t.includes("shower")) return 1;
  return 0;
}

export function precipTypeColor(
  type: PrecipTypeCode | undefined,
  intensityMmh: number,
  probability: number
): string {
  const active = intensityMmh > 0.02 || probability >= 0.12;
  if (!active && (type ?? 0) === 0) return "rgba(148, 163, 184, 0.14)";

  switch (type ?? 1) {
    case 2:
      return intensityMmh >= 1.5 ? "#e0f2fe" : "rgba(224, 242, 254, 0.55)";
    case 3:
      return "#c084fc";
    case 4:
      return "#a78bfa";
    default:
      break;
  }

  const effective = intensityMmh * Math.max(0.3, probability);
  if (effective < 0.1) return "#93c5fd";
  if (effective < 0.5) return "#60a5fa";
  if (effective < 2.5) return "#3b82f6";
  if (effective < 7.5) return "#6366f1";
  return "#ef4444";
}

/** Background for feels-like / air temp cells (heat index, wind chill). */
export function feelsLikeCellColor(feelsF: number): string {
  if (feelsF >= 105) return "rgba(220, 38, 38, 0.92)";
  if (feelsF >= 95) return "rgba(234, 88, 12, 0.88)";
  if (feelsF >= 85) return "rgba(245, 158, 11, 0.75)";
  if (feelsF >= 70) return "rgba(34, 197, 94, 0.45)";
  if (feelsF >= 45) return "rgba(56, 189, 248, 0.35)";
  if (feelsF >= 25) return "rgba(96, 165, 250, 0.45)";
  return "rgba(59, 130, 246, 0.55)";
}

export function heatStressLabel(feelsF: number): string | null {
  if (feelsF >= 105) return "Extreme heat stress";
  if (feelsF >= 95) return "High heat index";
  if (feelsF >= 85) return "Hot — stay hydrated";
  return null;
}

export function windGustBarHeight(gustMph: number, maxGust = 45): string {
  const g = Math.max(0, Math.min(maxGust, gustMph));
  const pct = 12 + (g / maxGust) * 88;
  return `${pct.toFixed(0)}%`;
}

export function windGustBarColor(gustMph: number): string {
  if (gustMph >= 40) return "rgba(234, 88, 12, 0.95)";
  if (gustMph >= 28) return "rgba(245, 158, 11, 0.85)";
  if (gustMph >= 18) return "rgba(251, 191, 36, 0.55)";
  return "rgba(148, 163, 184, 0.22)";
}

export function uvIndexColor(uv: number): string {
  if (uv >= 8) return "#ef4444";
  if (uv >= 6) return "#f97316";
  if (uv >= 3) return "#eab308";
  return "rgba(148, 163, 184, 0.45)";
}

export function uvIndexLabel(uv: number): string {
  if (uv >= 8) return "Very high UV";
  if (uv >= 6) return "High UV";
  if (uv >= 3) return "Moderate UV";
  return "Low UV";
}

export function precipTypeShortLabel(type: PrecipTypeCode | undefined): string {
  switch (type ?? 0) {
    case 2:
      return "Snow";
    case 3:
      return "Freezing rain";
    case 4:
      return "Sleet / ice";
    case 1:
      return "Rain";
    default:
      return "Dry";
  }
}
