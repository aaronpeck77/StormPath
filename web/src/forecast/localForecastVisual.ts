/** Shared colors and thresholds for advisory local-forecast timelines. */

/** 0=N/A 1=rain 2=snow 3=freezing rain 4=ice/hail */
export type PrecipTypeCode = 0 | 1 | 2 | 3 | 4;

const DRY_BAR = "rgba(148, 163, 184, 0.14)";

/** True when we should paint rain/snow on the local forecast strips (not just model noise). */
export function precipIsActive(
  intensityMmh: number,
  probability: number,
  type?: PrecipTypeCode
): boolean {
  const t = type ?? 0;
  if (intensityMmh >= 0.15) return true;
  if (intensityMmh >= 0.05 && probability >= 0.35) return true;
  if (t > 0 && probability >= 0.4) return true;
  if (probability >= 0.55) return true;
  return false;
}

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
  if (!precipIsActive(intensityMmh, probability, type)) return DRY_BAR;

  switch (type ?? 0) {
    case 0:
      break;
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
  if (feelsF >= 105) return "Extreme heat index";
  if (feelsF >= 95) return "High heat index";
  if (feelsF >= 85) return "Hot — stay hydrated";
  return null;
}

/** True when wind chill should be called out (cold air + wind making it feel colder). */
export function windChillNotable(feelsF: number, airF: number, windMph = 0): boolean {
  const feels = Math.round(feelsF);
  const air = Math.round(airF);
  if (feels > 40) return false;
  if (feels <= 32) return true;
  return feels <= 40 && air - feels >= 3 && windMph >= 6;
}

export function windChillStressLabel(feelsF: number): string | null {
  const feels = Math.round(feelsF);
  if (feels > 32) return null;
  if (feels <= -20) return "Extreme wind chill";
  if (feels <= 0) return "Dangerous wind chill";
  if (feels <= 15) return "Very low wind chill";
  return "Wind chill — bundle up";
}

/** NOAA Rothfusz regression; returns °F heat index when T ≥ 80°F, else null. */
export function estimateHeatIndexF(tempF: number, relativeHumidityPct: number): number | null {
  if (tempF < 80 || relativeHumidityPct <= 0) return null;
  const T = tempF;
  const RH = relativeHumidityPct;
  let hi =
    -42.379 +
    2.04901523 * T +
    10.14333127 * RH -
    0.22475541 * T * RH -
    0.00683783 * T * T -
    0.05481717 * RH * RH +
    0.00122874 * T * T * RH +
    0.00085282 * T * RH * RH -
    0.00000199 * T * T * RH * RH;
  if (RH < 13 && T >= 80 && T <= 112) {
    hi -= ((13 - RH) / 4) * Math.sqrt((17 - Math.abs(T - 95)) / 17);
  }
  if (RH > 85 && T >= 80 && T <= 87) {
    hi += ((RH - 85) / 10) * ((87 - T) / 5);
  }
  return Math.max(T, hi);
}

/** NWS wind chill (°F); valid for T ≤ 50°F and wind > 3 mph. */
export function estimateWindChillF(tempF: number, windMph: number): number | null {
  const T = tempF;
  const V = Math.max(windMph, 0);
  if (T > 50 || V <= 3) return null;
  const wc =
    35.74 +
    0.6215 * T -
    35.75 * Math.pow(V, 0.16) +
    0.4275 * T * Math.pow(V, 0.16);
  return Math.min(T, wc);
}

/** When provider apparent temp is within this of air, prefer humidity-based heat index in warm weather. */
const FEELS_LIKE_PROVIDER_TRUST_DELTA_F = 3;

/** Best available feels-like / heat index / wind chill for an hourly slot or current conditions. */
export function resolveHourFeelsLikeF(h: {
  tempF: number;
  feelsLikeF?: number;
  humidityPct?: number | null;
  windMph?: number;
}): number {
  const air = Math.round(h.tempF);
  let feels = air;
  if (h.feelsLikeF != null && Number.isFinite(h.feelsLikeF)) {
    feels = Math.round(h.feelsLikeF);
  }

  const wind = Math.max(0, h.windMph ?? 0);

  if (h.humidityPct != null && h.humidityPct > 0) {
    if (air >= 80) {
      const hi = estimateHeatIndexF(air, h.humidityPct);
      if (hi != null) feels = Math.max(feels, Math.round(hi));
    } else if (
      air >= 75 &&
      (h.feelsLikeF == null || Math.abs(feels - air) < FEELS_LIKE_PROVIDER_TRUST_DELTA_F)
    ) {
      const est = estimateHeatIndexF(air, h.humidityPct);
      if (est != null) feels = Math.max(feels, Math.round(est));
    }
  }

  if (air <= 50 && wind > 3) {
    const wc = estimateWindChillF(air, wind);
    if (wc != null) feels = Math.min(feels, Math.round(wc));
  }

  return feels;
}

/** Resolve apparent temp from a forecast interval (prefers gust for wind chill). */
export function resolveIntervalFeelsLikeF(h: {
  tempF: number;
  feelsLikeF?: number;
  humidityPct?: number | null;
  windMph?: number;
  windGustMph?: number;
}): number {
  return resolveHourFeelsLikeF({
    tempF: h.tempF,
    feelsLikeF: h.feelsLikeF,
    humidityPct: h.humidityPct,
    windMph: h.windGustMph ?? h.windMph ?? 0,
  });
}

export function hourComfortCallout(
  feelsF: number,
  airF: number,
  windMph = 0
): { kind: "heat" | "cold" | null; label: string | null } {
  const feels = Math.round(feelsF);
  const heat = heatStressLabel(feels);
  if (heat) return { kind: "heat", label: formatHeatIndexLine(feels) };
  if (windChillNotable(feels, airF, windMph)) {
    return { kind: "cold", label: windChillStressLabel(feels) };
  }
  return { kind: null, label: null };
}

/** True when heat index should be called out in the local forecast UI. */
export function heatIndexNotable(feelsF: number): boolean {
  return feelsF >= 85;
}

export function formatHeatIndexLine(feelsF: number): string {
  const rounded = Math.round(feelsF);
  const stress = heatStressLabel(rounded);
  return stress ? `Heat index up to ${rounded}° · ${stress}` : `Feels like ${rounded}°`;
}

export function formatWindChillLine(feelsF: number): string {
  const rounded = Math.round(feelsF);
  const stress = windChillStressLabel(rounded);
  return stress ? `Wind chill to ${rounded}° · ${stress}` : `Feels like ${rounded}°`;
}

/** True when a daily low apparent temp should be shown as wind chill (not just air temp). */
export function isWindChillDisplay(feelsF: number, airF: number): boolean {
  const feels = Math.round(feelsF);
  const air = Math.round(airF);
  return feels <= 40 && air - feels >= 2;
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

function precipChanceLabel(name: string, chance: number): string {
  return `${name} · ${Math.round(chance * 100)}% chance`;
}

export type DailyPrecipBadge = {
  label: string;
  type: PrecipTypeCode;
};

/** Week/day outlook badge — consistent "Rain · 52% chance" style with precip type for borders. */
export function dailyPrecipBadge(day: {
  precipChance: number;
  precipType?: number;
  snowfallCm?: number;
}): DailyPrecipBadge | null {
  const chance = day.precipChance;
  const type = (day.precipType ?? 0) as PrecipTypeCode;

  if (day.snowfallCm != null && day.snowfallCm > 0) {
    return chance >= 0.12
      ? { label: precipChanceLabel("Snow", chance), type: 2 }
      : { label: "Snow expected", type: 2 };
  }

  if (chance < 0.12 && type === 0) return null;

  if (type === 2) return { label: precipChanceLabel("Snow", chance), type: 2 };
  if (type === 3) return { label: precipChanceLabel("Freezing rain", chance), type: 3 };
  if (type === 4) return { label: precipChanceLabel("Sleet or ice", chance), type: 4 };
  if (type === 1 || chance >= 0.12) return { label: precipChanceLabel("Rain", chance), type: 1 };

  return null;
}

/** Week/day outlook badge text. */
export function dailyPrecipLabel(day: {
  precipChance: number;
  precipType?: number;
  snowfallCm?: number;
}): string | null {
  return dailyPrecipBadge(day)?.label ?? null;
}

/** Short label for an active precip hour — matches daily "Rain · 52% chance" badges. */
export function precipDisplayLabel(
  type: PrecipTypeCode | undefined,
  intensityMmh: number,
  probability: number
): string | null {
  if (!precipIsActive(intensityMmh, probability, type)) return null;
  const typeCode = (type ?? 0) as PrecipTypeCode;
  if (typeCode > 0) {
    return precipChanceLabel(precipTypeShortLabel(typeCode), probability);
  }
  if (probability >= 0.12) return precipChanceLabel("Rain", probability);
  if (intensityMmh >= 0.15) return "Rain";
  return null;
}
