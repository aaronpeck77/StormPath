import type { RouteTurnStep } from "./types";

/**
 * Mapbox/OSRM-style maneuver → compact road-sign-like glyph.
 * Returns null when type/modifier are missing or unrecognized so callers can fall back.
 */
export function mapboxStyleManeuverIcon(mt?: string, mod?: string): string | null {
  const t = (mt ?? "").toLowerCase().trim();
  const m = (mod ?? "").toLowerCase().trim();

  if (
    t.includes("roundabout") ||
    t.includes("rotary") ||
    t === "exit roundabout" ||
    t === "exit rotary"
  ) {
    return "⟳";
  }
  if (t === "arrive" || t === "arrive destination") return "◎";
  if (t === "fork") {
    if (m.includes("left")) return "↰";
    if (m.includes("right")) return "↱";
    return "⑂";
  }
  if (t === "merge") {
    if (m.includes("left")) return "⤴";
    if (m.includes("right")) return "⤵";
    return "⤦";
  }
  if (t === "off ramp" || t === "on ramp" || t === "ramp" || t === "exit") {
    if (m.includes("left")) return "↖";
    if (m.includes("right")) return "↗";
    return "↗";
  }
  if (
    t === "turn" ||
    t === "end of road" ||
    t === "continue" ||
    t === "new name" ||
    t === "notification" ||
    t === "depart" ||
    !t
  ) {
    const fromMod = iconFromModifier(m);
    if (fromMod) return fromMod;
    if (t === "depart") return "↑";
    if (t === "continue" || t === "new name") return "↑";
  }

  // Unknown type but a clear direction modifier — still prefer a turn glyph over straight.
  const fromMod = iconFromModifier(m);
  if (fromMod) return fromMod;

  return null;
}

function iconFromModifier(m: string): string | null {
  if (!m) return null;
  if (m.includes("uturn") || m === "u-turn") return "↻";
  if (m.includes("sharp left")) return "↲";
  if (m.includes("slight left")) return "↖";
  if (m === "left" || m.includes("left")) return "↰";
  if (m.includes("sharp right")) return "↳";
  if (m.includes("slight right")) return "↗";
  if (m === "right" || m.includes("right")) return "↱";
  if (m.includes("straight")) return "↑";
  return null;
}

/**
 * Infer a glyph from instruction text. Native Mapbox visual primary text is often just the
 * street name ("Main St") with no turn verb — callers should prefer structured type/modifier.
 */
export function inferManeuverIconFromInstruction(instr: string): string {
  const s = instr.toLowerCase();
  if (/\bu-?turn|uturn|make a u-turn/i.test(instr)) return "↻";
  if (/roundabout|rotary|traffic circle/i.test(s)) return "⟳";
  if (/merge|lane ends|lanes end/i.test(s)) return "⤦";
  if (/fork/i.test(s)) return "⑂";
  if (/destination|arrive|you('ll)? (have )?arrived/i.test(s)) return "◎";

  // Direction first — covers "Turn left", "Take a left", "Left onto Main", "Keep left".
  if (/\b(sharp|hard)\s+left\b/.test(s) || /sharp left|hard left/i.test(s)) return "↲";
  if (/\b(slight|bear)\s+left\b/.test(s) || /slight left|bear left/i.test(s)) return "↖";
  if (/\bleft\b/.test(s) && !/\bright\b/.test(s)) return "↰";
  if (/\b(sharp|hard)\s+right\b/.test(s) || /sharp right|hard right/i.test(s)) return "↳";
  if (/\b(slight|bear)\s+right\b/.test(s) || /slight right|bear right/i.test(s)) return "↗";
  if (/\bright\b/.test(s) && !/\bleft\b/.test(s)) return "↱";

  if (/continue|head|straight|proceed|stay on|follow/i.test(s)) return "↑";
  return "↑";
}

export function orsManeuverIcon(type?: number): string {
  if (type == null) return "↑";
  switch (type) {
    case 0:
      return "↰";
    case 1:
      return "↱";
    case 2:
      return "↲";
    case 3:
      return "↳";
    case 4:
      return "↖";
    case 5:
      return "↗";
    case 6:
      return "↑";
    case 7:
    case 8:
      return "⟳";
    case 9:
      return "↻";
    case 10:
      return "◎";
    case 11:
      return "▶";
    case 12:
      return "←|";
    case 13:
      return "|→";
    default:
      return "↑";
  }
}

export function maneuverIconForStep(step: RouteTurnStep): string {
  const mb = mapboxStyleManeuverIcon(step.maneuverType, step.maneuverModifier);
  if (mb) return mb;
  if (step.type != null) return orsManeuverIcon(step.type);
  return inferManeuverIconFromInstruction(step.instruction);
}

/**
 * Primary banner icon. Prefer structured Mapbox type/modifier over instruction text —
 * native visual primary text is frequently just the road name, which would otherwise
 * incorrectly fall through to a straight arrow.
 */
export function resolvePrimaryManeuverIcon(input: {
  stayOnMode: boolean;
  step: RouteTurnStep;
  instructionOverride?: string | null;
}): string {
  if (input.stayOnMode) return "↑";
  const structured = mapboxStyleManeuverIcon(
    input.step.maneuverType,
    input.step.maneuverModifier
  );
  if (structured) return structured;
  if (input.step.type != null) return orsManeuverIcon(input.step.type);
  const text =
    input.instructionOverride?.replace(/\s+/g, " ").trim() ||
    input.step.instruction.replace(/\s+/g, " ").trim();
  return inferManeuverIconFromInstruction(text);
}
