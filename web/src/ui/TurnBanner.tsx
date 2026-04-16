import { useMemo } from "react";
import type { ReactNode } from "react";
import type { RouteTurnStep } from "../nav/types";

/**
 * Split instruction into text + US-style shields (Interstate / US / state routes).
 * Mapbox often writes "Interstate 55" or "I 55" — normalize to I-## for the shield row.
 */
function instructionWithRoadShields(text: string): ReactNode {
  const re =
    /\b(?:I-(\d{1,3})|I\s+(\d{1,3})|Interstate\s+(\d{1,3})|US-(\d{1,3})|US\s+(\d{1,3})|SR-(\d{1,3})|SR\s+(\d{1,3}))\b/gi;
  const parts: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      parts.push(text.slice(last, m.index));
    }
    const i = m[1] ?? m[2] ?? m[3];
    const us = m[4] ?? m[5];
    const sr = m[6] ?? m[7];
    let display: string;
    let cls: string;
    if (i) {
      display = `I-${i}`;
      cls = "road-shield road-shield--interstate";
    } else if (us) {
      display = `US-${us}`;
      cls = "road-shield road-shield--us";
    } else {
      display = `SR-${sr}`;
      cls = "road-shield road-shield--sr";
    }
    parts.push(
      <span key={`${key++}`} className={cls}>
        {display}
      </span>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    parts.push(text.slice(last));
  }
  return parts.length ? <>{parts}</> : text;
}

/** Mapbox/OSRM-style maneuver → compact road-sign-like glyph (falls back to instruction heuristics). */
function mapboxStyleManeuverIcon(mt?: string, mod?: string): string | null {
  const t = (mt ?? "").toLowerCase();
  const m = (mod ?? "").toLowerCase();
  if (
    t.includes("roundabout") ||
    t.includes("rotary") ||
    t === "exit roundabout" ||
    t === "exit rotary"
  ) {
    return "⟳";
  }
  if (t === "arrive" || t === "arrive destination") return "◎";
  if (t === "fork") return "⑂";
  if (t === "merge") {
    if (m.includes("left")) return "⤴";
    if (m.includes("right")) return "⤵";
    return "⤦";
  }
  if (t === "off ramp" || t === "ramp" || t === "exit") {
    if (m.includes("left")) return "↖";
    if (m.includes("right")) return "↗";
    return "↗";
  }
  if (t === "turn" || t === "end of road" || t === "continue" || t === "new name" || t === "notification") {
    if (m.includes("uturn")) return "↻";
    if (m.includes("sharp left")) return "↲";
    if (m.includes("slight left")) return "↖";
    if (m === "left") return "↰";
    if (m.includes("left")) return "↰";
    if (m.includes("sharp right")) return "↳";
    if (m.includes("slight right")) return "↗";
    if (m === "right") return "↱";
    if (m.includes("right")) return "↱";
    if (m.includes("straight")) return "↑";
  }
  if (t === "depart") return "↑";
  return null;
}

function inferManeuverIconFromInstruction(instr: string): string {
  const s = instr.toLowerCase();
  if (/\bu-?turn|uturn|make a u-turn/i.test(instr)) return "↻";
  if (/roundabout|rotary|traffic circle/i.test(s)) return "⟳";
  if (/merge|lane ends|lanes end/i.test(s)) return "⤦";
  if (/fork|keep (left|right)/i.test(s)) return "⑂";
  if (/destination|arrive|you('ll)? (have )?arrived/i.test(s)) return "◎";
  if (/slight left|bear left/i.test(s)) return "↖";
  if (/sharp left|hard left/i.test(s)) return "↲";
  if (/\bleft\b/.test(s) && /turn|keep|stay|veer/.test(s)) return "↰";
  if (/slight right|bear right/i.test(s)) return "↗";
  if (/sharp right|hard right/i.test(s)) return "↳";
  if (/\bright\b/.test(s) && /turn|keep|stay|veer/.test(s)) return "↱";
  if (/continue|head|straight|proceed|stay on|follow/i.test(s)) return "↑";
  return "↑";
}

function maneuverIconForStep(step: RouteTurnStep): string {
  const mb = mapboxStyleManeuverIcon(step.maneuverType, step.maneuverModifier);
  if (mb) return mb;
  if (step.type != null) return orsManeuverIcon(step.type);
  return inferManeuverIconFromInstruction(step.instruction);
}

function formatStepDistanceM(m?: number): string {
  if (m == null || m <= 0) return "";
  const ft = m * 3.28084;
  if (ft < 500) return `${Math.round(ft)} ft`;
  const mi = m / 1609.34;
  return mi < 10 ? `${mi.toFixed(1)} mi` : `${Math.round(mi)} mi`;
}

function orsManeuverIcon(type?: number): string {
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

function trunc(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

function formatAlongMeters(m: number): string {
  if (m < 8) return "";
  const ft = m * 3.28084;
  if (ft < 900) return `${Math.round(ft)} ft`;
  const mi = m / 1609.34;
  return mi < 10 ? `${mi.toFixed(1)} mi` : `${Math.round(mi)} mi`;
}

type Props = {
  visible: boolean;
  steps: RouteTurnStep[];
  /** Primary step index (next meaningful maneuver; may skip minor steps while they are still far). */
  activeIndex: number;
  /** Along-route distance remaining to that primary maneuver (polyline sync). */
  metersToManeuverEnd?: number | null;
};

export function TurnBanner({ visible, steps, activeIndex, metersToManeuverEnd }: Props) {
  if (!visible) return null;

  if (steps.length === 0) {
    return (
      <div className="turn-banner turn-banner--split" role="status">
        <div className="turn-banner-col turn-banner-col--primary">
          <span className="turn-banner-icon" aria-hidden>
            ○
          </span>
          <div className="turn-banner-text">
            <span className="turn-banner-street">No turn list for this route</span>
            <span className="turn-banner-dist">Use an OpenRoute key for step-by-step</span>
          </div>
        </div>
      </div>
    );
  }

  const idx = Math.max(0, Math.min(activeIndex, steps.length - 1));
  const cur = steps[idx]!;
  const next = steps[idx + 1];
  const remainM = metersToManeuverEnd ?? 0;
  const alongLabel = formatAlongMeters(remainM);
  const distLabel =
    alongLabel ||
    (formatStepDistanceM(cur.distanceM) ? `${formatStepDistanceM(cur.distanceM)}` : "");

  // Changing keys on maneuver blocks gives a simple “slides over” feel when the next step becomes current.
  const primaryKey = useMemo(() => `primary-${idx}-${cur.instruction}`, [idx, cur.instruction]);
  const nextKey = useMemo(() => `next-${idx + 1}-${next?.instruction ?? ""}`, [idx, next?.instruction]);

  return (
    <div className="turn-banner turn-banner--split" role="status">
      <div className="turn-banner-col turn-banner-col--primary" key={primaryKey}>
        <span className="turn-banner-icon" aria-hidden>
          {maneuverIconForStep(cur)}
        </span>
        <div className="turn-banner-text">
          <span className="turn-banner-street">{instructionWithRoadShields(cur.instruction)}</span>
          <span className="turn-banner-dist">
            {alongLabel ? `${alongLabel} ahead` : distLabel ? `${distLabel} ahead` : "Now"}
          </span>
        </div>
      </div>
      <div className="turn-banner-col turn-banner-col--next" aria-label="Following maneuver">
        {next ? (
          <>
            <div className="turn-banner-next-main" key={nextKey}>
              <span className="turn-banner-icon turn-banner-icon--next" aria-hidden>
                {maneuverIconForStep(next)}
              </span>
              <div className="turn-banner-next-text">
                <p className="turn-banner-next-instr">
                  {instructionWithRoadShields(trunc(next.instruction, 96))}
                </p>
                <div className="turn-banner-next-meta-row">
                  {formatStepDistanceM(next.distanceM) ? (
                    <span className="turn-banner-next-meta">{formatStepDistanceM(next.distanceM)}</span>
                  ) : null}
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            <p className="turn-banner-next-instr turn-banner-next-instr--dest">Arriving</p>
          </>
        )}
      </div>
    </div>
  );
}
