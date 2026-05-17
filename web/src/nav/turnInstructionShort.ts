/**
 * Turn lines for the banner: compact on limited-access roads (Interstate / US / state routes),
 * fuller Mapbox sentences on local streets so names stay visible in town.
 */

/** Normalize to display tokens used in UI + shield regexes. */
export function pickPrimaryRoadName(instruction: string, stepName?: string, stepRef?: string): string | null {
  const hay = [stepRef, stepName, instruction].filter(Boolean).join(" | ");
  let m = hay.match(/\b(?:I[-\s]?|Interstate[-\s]?)(\d{1,3})\b/i);
  if (m) return `I-${m[1]}`;
  m = hay.match(/\bUS[-\s]?(\d{1,3})\b/i);
  if (m) return `US-${m[1]}`;
  m = hay.match(/\b(?:SR|State\s+Route|State\s+Rout(?:e)?|State\s+Hwy|Hwy\.?|Highway)\s*(\d{1,3})\b/i);
  if (m) return `SR-${m[1]}`;
  m = hay.match(/\b(?:South|North|East|West)\s+State\s+Rout(?:e)?\.?\s*(\d{1,3})\b/i);
  if (m) return `SR-${m[1]}`;
  const onto = instruction.match(/\b(?:onto|on|toward)\s+([^,.;]+?)(?:\.|,|;|$)/i);
  const raw = (onto?.[1] ?? stepName ?? "").trim();
  if (!raw) return null;
  return raw.replace(/\s+/g, " ").trim();
}

type RoadInstructionContext = "interstate" | "us_hwy" | "state_hwy" | "street";

/** Classify step for banner wording: limited-access vs surface streets. */
function roadInstructionContext(stepName?: string, stepRef?: string, rawInstr?: string): RoadInstructionContext {
  const hay = `${stepRef ?? ""} ${stepName ?? ""} ${rawInstr ?? ""}`;
  if (/\b(?:I[-\s]?|Interstate[-\s]?)(\d{1,3})\b/i.test(hay)) return "interstate";
  if (/\bUS[-\s]?\d{1,3}\b/i.test(hay)) return "us_hwy";
  if (
    /\b(?:SR|State\s+Route|State\s+Hwy|Hwy\.?|Highway)\s*\d{1,3}\b/i.test(hay) ||
    /\b(?:Freeway|Expressway|Turnpike)\b/i.test(hay)
  ) {
    return "state_hwy";
  }
  return "street";
}

function shortenVerb(instr: string): string {
  const s = instr.trim();
  const low = s.toLowerCase();
  if (/^u-?turn|make a u-turn/i.test(s)) return "U-turn";
  if (low.includes("roundabout") || low.includes("rotary")) return "Roundabout";
  if (/merge/i.test(low)) return "Merge";
  if (/exit|ramp|off ramp/i.test(low)) return "Exit";
  if (/fork/i.test(low)) return "Fork";
  if (/arrive|destination/i.test(low)) return "Arrive";
  if (/bear\s+right|slight\s+right/i.test(low)) return "Bear R";
  if (/bear\s+left|slight\s+left/i.test(low)) return "Bear L";
  if (/sharp\s+right|hard\s+right/i.test(low)) return "Hard R";
  if (/sharp\s+left|hard\s+left/i.test(low)) return "Hard L";
  if (/\bturn\s+right\b|\bright\b.*turn/i.test(low)) return "Right";
  if (/\bturn\s+left\b|\bleft\b.*turn/i.test(low)) return "Left";
  if (/continue|head|proceed|follow the road|stay on/i.test(low)) return "Continue";
  if (/keep\s+right/i.test(low)) return "Keep R";
  if (/keep\s+left/i.test(low)) return "Keep L";
  if (/depart|start/i.test(low)) return "Go";
  return "Continue";
}

/**
 * Mapbox/OSRM full sentence → banner line: compact shields on highways, full Mapbox text on streets.
 */
export function shortenTurnInstruction(instruction: string, stepName?: string, stepRef?: string): string {
  const raw = instruction.replace(/\s+/g, " ").trim();
  if (!raw) return "";
  const ctx = roadInstructionContext(stepName, stepRef, raw);

  if (ctx === "interstate" || ctx === "us_hwy" || ctx === "state_hwy") {
    const road = pickPrimaryRoadName(raw, stepName, stepRef);
    const verb = shortenVerb(raw);
    if (road) return `${verb} · ${road}`;
  }

  return raw;
}
