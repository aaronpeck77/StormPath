import type { ReactNode } from "react";
import {
  formatStayOnRoadLabel,
  resolveStayOnBannerCopy,
  roadLabelFromContinueInstruction,
} from "../nav/bannerStayOnCopy";
import { maneuverIconForStep, resolvePrimaryManeuverIcon } from "../nav/maneuverIcon";
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

function formatStepDistanceM(m?: number): string {
  if (m == null || m <= 0) return "";
  const ft = m * 3.28084;
  if (ft < 500) return `${Math.round(ft)} ft`;
  const mi = m / 1609.34;
  return mi < 10 ? `${mi.toFixed(1)} mi` : `${Math.round(mi)} mi`;
}

function formatAlongMeters(m: number): string {
  if (m < 8) return "";
  const ft = m * 3.28084;
  if (ft < 900) return `${Math.round(ft)} ft`;
  const mi = m / 1609.34;
  return mi < 10 ? `${mi.toFixed(1)} mi` : `${Math.round(mi)} mi`;
}

function resolveRoadLabel(input: {
  currentRoadName?: string | null;
  currentRoadRef?: string | null;
  travelingStep?: RouteTurnStep | null;
  turnInstruction: string;
}): string | null {
  const fromLive = formatStayOnRoadLabel({
    roadName: input.currentRoadName,
    roadRef: input.currentRoadRef,
  });
  if (fromLive) return fromLive;
  const fromStep = formatStayOnRoadLabel({
    roadName: input.travelingStep?.roadName,
    roadRef: input.travelingStep?.roadRef,
  });
  if (fromStep) return fromStep;
  return roadLabelFromContinueInstruction(input.turnInstruction);
}

type Props = {
  visible: boolean;
  steps: RouteTurnStep[];
  /** Primary step index (next meaningful maneuver; may skip minor steps while they are still far). */
  activeIndex: number;
  /** Along-route distance remaining to that primary maneuver (polyline sync). */
  metersToManeuverEnd?: number | null;
  /**
   * When set (iOS native Core), show this instruction instead of `steps[activeIndex]`.
   * Keeps the banner synced with Mapbox progress when DIY turnSteps diverge.
   */
  instructionOverride?: string | null;
  /** Road currently being traveled (native progress or DIY current step). */
  currentRoadName?: string | null;
  currentRoadRef?: string | null;
  /** Index of the step being traveled (for DIY road name when live props empty). */
  travelingStepIndex?: number | null;
};

export function TurnBanner({
  visible,
  steps,
  activeIndex,
  metersToManeuverEnd,
  instructionOverride = null,
  currentRoadName = null,
  currentRoadRef = null,
  travelingStepIndex = null,
}: Props) {
  if (!visible) return null;

  const override = instructionOverride?.replace(/\s+/g, " ").trim() || null;

  if (steps.length === 0) {
    if (override) {
      const remainM = metersToManeuverEnd ?? 0;
      const alongLabel = formatAlongMeters(remainM);
      const roadLabel = resolveRoadLabel({
        currentRoadName,
        currentRoadRef,
        turnInstruction: override,
      });
      const copy = resolveStayOnBannerCopy({
        remainM,
        turnInstruction: override,
        roadLabel,
        alongLabel,
        distFallback: "",
      });
      return (
        <div className="turn-banner turn-banner--split" role="status">
          <div className="turn-banner-col turn-banner-col--primary">
            <span className="turn-banner-icon" aria-hidden>
              {resolvePrimaryManeuverIcon({
                stayOnMode: copy.stayOnMode,
                step: { instruction: override },
                instructionOverride: override,
              })}
            </span>
            <div className="turn-banner-text">
              <span className="turn-banner-street">{instructionWithRoadShields(copy.headline)}</span>
              <div className="turn-banner-meta-row">
                <span className="turn-banner-dist">{copy.distLine}</span>
              </div>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="turn-banner turn-banner--split" role="status">
        <div className="turn-banner-col turn-banner-col--primary">
          <span className="turn-banner-icon" aria-hidden>
            ○
          </span>
          <div className="turn-banner-text">
            <span className="turn-banner-street">No turn list for this route</span>
            <span className="turn-banner-dist">Follow the route line on the map</span>
          </div>
        </div>
      </div>
    );
  }

  const idx = Math.max(0, Math.min(activeIndex, steps.length - 1));
  const cur = steps[idx]!;
  const next = steps[idx + 1];
  const travelIdx =
    travelingStepIndex != null && Number.isFinite(travelingStepIndex)
      ? Math.max(0, Math.min(Math.floor(travelingStepIndex), steps.length - 1))
      : Math.max(0, idx - 1);
  const travelingStep = steps[travelIdx] ?? null;
  const primaryInstr = override ?? cur.instruction;
  const remainM = metersToManeuverEnd ?? 0;
  const alongLabel = formatAlongMeters(remainM);
  const distLabel =
    alongLabel ||
    (formatStepDistanceM(cur.distanceM) ? `${formatStepDistanceM(cur.distanceM)}` : "");
  const roadLabel = resolveRoadLabel({
    currentRoadName,
    currentRoadRef,
    travelingStep,
    turnInstruction: primaryInstr,
  });
  const copy = resolveStayOnBannerCopy({
    remainM,
    turnInstruction: primaryInstr,
    roadLabel,
    alongLabel,
    distFallback: distLabel,
  });

  // Changing keys on maneuver blocks gives a simple “slides over” feel when the next step becomes current.
  const primaryKey = `primary-${idx}-${copy.headline}-${copy.stayOnMode ? "stay" : "turn"}`;
  const thenStep = copy.stayOnMode ? cur : next;
  const thenInstr = copy.stayOnMode ? primaryInstr : next?.instruction ?? "";
  const nextKey = `next-${idx}-${copy.stayOnMode ? "turn" : "after"}-${thenInstr}`;

  const primaryIcon = resolvePrimaryManeuverIcon({
    stayOnMode: copy.stayOnMode,
    step: cur,
    instructionOverride: override,
  });

  return (
    <div className="turn-banner turn-banner--split" role="status">
      <div className="turn-banner-col turn-banner-col--primary" key={primaryKey}>
        <span className="turn-banner-icon" aria-hidden>
          {primaryIcon}
        </span>
        <div className="turn-banner-text">
          <span className="turn-banner-street">{instructionWithRoadShields(copy.headline)}</span>
          <div className="turn-banner-meta-row">
            <span className="turn-banner-dist">{copy.distLine}</span>
            {!copy.stayOnMode && cur.exitNumber ? (
              <span className="turn-banner-exit">Exit {cur.exitNumber}</span>
            ) : null}
          </div>
        </div>
      </div>
      <div className="turn-banner-col turn-banner-col--next" aria-label="Following maneuver">
        {thenStep ? (
          <>
            <span className="turn-banner-next-label">Then</span>
            <div className="turn-banner-next-main" key={nextKey}>
              <span className="turn-banner-icon turn-banner-icon--next" aria-hidden>
                {copy.stayOnMode
                  ? resolvePrimaryManeuverIcon({
                      stayOnMode: false,
                      step: cur,
                      instructionOverride: override,
                    })
                  : maneuverIconForStep(thenStep)}
              </span>
              <div className="turn-banner-next-text">
                <p className="turn-banner-next-instr">
                  {instructionWithRoadShields(
                    (copy.stayOnMode ? primaryInstr : thenStep.instruction).replace(/\s+/g, " ").trim()
                  )}
                </p>
                <div className="turn-banner-next-meta-row">
                  {!copy.stayOnMode && formatStepDistanceM(thenStep.distanceM) ? (
                    <span className="turn-banner-next-meta">
                      {formatStepDistanceM(thenStep.distanceM)}
                    </span>
                  ) : null}
                  {thenStep.exitNumber ? (
                    <span className="turn-banner-next-meta turn-banner-next-meta--exit">
                      Exit {thenStep.exitNumber}
                    </span>
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
