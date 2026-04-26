import type { RouteTurnStep } from "../nav/types";
import { TurnBanner } from "./TurnBanner";
import { StormIdleIllustration } from "./StormIdleIllustration";

type Props = {
  /** When false, show idle branding instead of turn list. */
  hasRoute: boolean;
  /** Plus shows logo-only idle; Basic may show upgrade hint in the strip. */
  isPlus: boolean;
  turnSteps: RouteTurnStep[];
  /** Index into `turnSteps` for the primary line (meaningful upcoming maneuver). */
  activeTurnIndex: number;
  metersToManeuverEnd?: number | null;
  /** Drive mode: larger icon + type for at-a-glance reading. */
  glanceable?: boolean;
};

export function TopGuidanceBar({
  hasRoute,
  isPlus,
  turnSteps,
  activeTurnIndex,
  metersToManeuverEnd,
  glanceable = false,
}: Props) {
  return (
    <div
      className={`top-guidance-bar top-guidance-bar--turn-only${glanceable ? " top-guidance-bar--glanceable" : ""}`}
      role="region"
      aria-label="Turn-by-turn"
    >
      {hasRoute ? (
        <TurnBanner
          visible
          steps={turnSteps}
          activeIndex={activeTurnIndex}
          metersToManeuverEnd={metersToManeuverEnd}
        />
      ) : (
        <div className="turn-strip-idle" role="status" aria-label="StormPath">
          <div className="turn-strip-idle__hero">
            <div className="turn-strip-idle__art" aria-hidden="true">
              <div className="turn-strip-idle__art-scale">
                <StormIdleIllustration />
              </div>
            </div>
            <div className="turn-strip-idle__titles">
              <div className="turn-strip-idle__wordmark">
                <span className="turn-strip-idle__storm">Storm</span>
                <span className="turn-strip-idle__path">Path</span>
              </div>
            </div>
          </div>
          {!isPlus && (
            <p className="turn-strip-idle__ad">
              Navigation &amp; radar — <strong>Plus</strong> adds live traffic, the full advisory map, and route tools.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
