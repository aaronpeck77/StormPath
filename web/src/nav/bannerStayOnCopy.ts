/** Farther than this → “Stay on …” instead of turn countdown (≈ 2 mi). */
export const STAY_ON_BANNER_MIN_M = 3_219;

function normalizeRoadKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Prefer highway ref (I-72) over long street names when both exist. */
export function formatStayOnRoadLabel(input: {
  roadName?: string | null;
  roadRef?: string | null;
}): string | null {
  const ref = input.roadRef?.replace(/\s+/g, " ").trim() || "";
  const name = input.roadName?.replace(/\s+/g, " ").trim() || "";
  if (!ref) return name || null;
  if (!name) return ref;
  const refKey = normalizeRoadKey(ref);
  const nameKey = normalizeRoadKey(name);
  if (refKey && (nameKey.includes(refKey) || refKey.includes(nameKey))) {
    // Prefer compact shield-style ref when it's the same road.
    return ref.length <= name.length ? ref : name;
  }
  return `${ref} / ${name}`;
}

/**
 * Guess a road label from a Mapbox-style continue instruction when structured
 * names are missing (DIY / web path).
 */
export function roadLabelFromContinueInstruction(instruction: string): string | null {
  const s = instruction.replace(/\s+/g, " ").trim();
  if (!s) return null;
  const m =
    /^(?:continue|stay)\s+(?:on|onto|along)\s+(.+?)(?:\s+for\b|\s+toward\b|$)/i.exec(s) ||
    /^head\s+\w+\s+on\s+(.+?)(?:\s+for\b|$)/i.exec(s);
  if (!m?.[1]) return null;
  const road = m[1].replace(/[.]+$/, "").trim();
  return road.length >= 2 ? road : null;
}

export type StayOnBannerCopy = {
  stayOnMode: boolean;
  /** Main banner line */
  headline: string;
  /** Distance / status under the headline */
  distLine: string;
};

/**
 * Long straightaways: emphasize the road you’re on. Near the turn: normal countdown.
 */
export function resolveStayOnBannerCopy(input: {
  remainM: number;
  turnInstruction: string;
  roadLabel: string | null;
  alongLabel: string;
  distFallback: string;
}): StayOnBannerCopy {
  const turn = input.turnInstruction.replace(/\s+/g, " ").trim() || "Continue";
  const far =
    Number.isFinite(input.remainM) &&
    input.remainM >= STAY_ON_BANNER_MIN_M &&
    Boolean(input.roadLabel);

  if (far && input.roadLabel) {
    const forPart = input.alongLabel
      ? `for ${input.alongLabel}`
      : input.distFallback
        ? `for ${input.distFallback}`
        : "ahead";
    return {
      stayOnMode: true,
      headline: `Stay on ${input.roadLabel}`,
      distLine: forPart,
    };
  }

  return {
    stayOnMode: false,
    headline: turn,
    distLine: input.alongLabel
      ? `${input.alongLabel} ahead`
      : input.distFallback
        ? `${input.distFallback} ahead`
        : "Now",
  };
}
