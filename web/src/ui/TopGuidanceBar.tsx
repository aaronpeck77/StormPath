import { useMemo } from "react";
import type { RouteTurnStep } from "../nav/types";
import { TurnBanner } from "./TurnBanner";
import { StormIdleIllustration } from "./StormIdleIllustration";
import { getCurrentSeason } from "./seasonTheme";

type Props = {
  /** When false, show idle branding instead of turn list. */
  hasRoute: boolean;
  turnSteps: RouteTurnStep[];
  /** Index into `turnSteps` for the primary line (meaningful upcoming maneuver). */
  activeTurnIndex: number;
  metersToManeuverEnd?: number | null;
  /** Drive mode: larger icon + type for at-a-glance reading. */
  glanceable?: boolean;
};

export function TopGuidanceBar({
  hasRoute,
  turnSteps,
  activeTurnIndex,
  metersToManeuverEnd,
  glanceable = false,
}: Props) {
  /* Resolved once per mount — seasons don't shift mid-session, and the URL override (used for
   * preview / testing) is also stable for the page lifetime. Re-mounting the bar (e.g. on
   * navigation away and back) will pick up a new value if the date crossed a season boundary. */
  const season = useMemo(() => getCurrentSeason(), []);
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
        <div
          className={`turn-strip-idle turn-strip-idle--season-${season}`}
          role="status"
          aria-label="StormPath"
        >
          <div className="turn-strip-idle__hero">
            <div className="turn-strip-idle__art" aria-hidden="true">
              <div className="turn-strip-idle__art-scale">
                <StormIdleIllustration season={season} />
              </div>
            </div>
            <div className="turn-strip-idle__titles">
              <div className="turn-strip-idle__wordmark">
                <span className="turn-strip-idle__storm">Storm</span>
                <span className="turn-strip-idle__path">Path</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
