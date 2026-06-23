/**
 * Speed-aware maneuver voice bands — early / medium / close / now.
 * Distances widen at highway speed so prompts arrive with time to react.
 */

export type VoiceManeuverBand = "early" | "medium" | "close" | "now";

export type VoiceManeuverThresholds = {
  earlyM: number;
  mediumM: number;
  closeM: number;
  nowM: number;
};

const BAND_ORDER: VoiceManeuverBand[] = ["early", "medium", "close", "now"];

export function voiceManeuverThresholds(speedMps: number | null | undefined): VoiceManeuverThresholds {
  const s = speedMps ?? 0;
  if (s >= 22) {
    return { earlyM: 900, mediumM: 400, closeM: 120, nowM: 45 };
  }
  if (s >= 13) {
    return { earlyM: 550, mediumM: 200, closeM: 70, nowM: 35 };
  }
  return { earlyM: 250, mediumM: 90, closeM: 35, nowM: 18 };
}

export function voiceBandOrdinal(band: VoiceManeuverBand): number {
  return BAND_ORDER.indexOf(band);
}

/** Closest band for current distance, or null when still outside the early window. */
export function voiceBandForDistance(
  meters: number,
  thresholds: VoiceManeuverThresholds
): VoiceManeuverBand | null {
  if (!Number.isFinite(meters) || meters < 0) return null;
  if (meters <= thresholds.nowM) return "now";
  if (meters <= thresholds.closeM) return "close";
  if (meters <= thresholds.mediumM) return "medium";
  if (meters <= thresholds.earlyM) return "early";
  return null;
}

/**
 * Band to speak on a new maneuver — uses the tightest applicable band, or early with a
 * long-distance prefix when the driver is still outside the early window.
 */
export function voiceBandToSpeak(
  meters: number,
  thresholds: VoiceManeuverThresholds,
  stepIndexChanged: boolean
): VoiceManeuverBand | null {
  const inBand = voiceBandForDistance(meters, thresholds);
  if (inBand) return inBand;
  if (stepIndexChanged && meters > thresholds.earlyM) return "early";
  return null;
}

export function formatVoiceDistancePrefix(meters: number, band: VoiceManeuverBand): string {
  if (band === "now") return "Now. ";
  if (!Number.isFinite(meters) || meters <= 15) return "";

  if (band === "close") {
    const ft = meters * 3.28084;
    return ft < 500 ? `In ${Math.round(ft)} feet, ` : `In about ${Math.round(meters)} meters, `;
  }

  const ft = meters * 3.28084;
  if (ft < 750) {
    return `In about ${Math.round(ft)} feet, `;
  }
  const mi = meters / 1609.34;
  if (mi < 10) return `In about ${mi.toFixed(1)} miles, `;
  return `In about ${Math.round(mi)} miles, `;
}
