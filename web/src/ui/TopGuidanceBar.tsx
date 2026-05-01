import type { RouteTurnStep } from "../nav/types";
import type { DriveNextHazardAhead } from "../nav/driveRouteAhead";
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
  /** Next along-route hazard (weather / road / anchored traffic) with distance + ETA. */
  nextHazardAhead?: DriveNextHazardAhead | null;
};

export function TopGuidanceBar({
  hasRoute,
  isPlus,
  turnSteps,
  activeTurnIndex,
  metersToManeuverEnd,
  glanceable = false,
  nextHazardAhead = null,
}: Props) {
  return (
    <div
      className={`top-guidance-bar top-guidance-bar--turn-only${glanceable ? " top-guidance-bar--glanceable" : ""}`}
      role="region"
      aria-label="Turn-by-turn"
    >
      {hasRoute ? (
        <>
          <TurnBanner
            visible
            steps={turnSteps}
            activeIndex={activeTurnIndex}
            metersToManeuverEnd={metersToManeuverEnd}
          />
          {glanceable && nextHazardAhead ? (
            <div
              className={`top-guidance-bar__next-hazard top-guidance-bar__next-hazard--sev-${nextHazardAhead.severity}`}
              role="status"
              aria-label={`Next hazard: ${nextHazardAhead.title}`}
            >
              <span className="top-guidance-bar__next-hazard-label">Next</span>
              <span className="top-guidance-bar__next-hazard-title">{nextHazardAhead.title}</span>
              {nextHazardAhead.sub ? (
                <span className="top-guidance-bar__next-hazard-sub">{nextHazardAhead.sub}</span>
              ) : null}
            </div>
          ) : null}
        </>
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
            <p className="turn-strip-idle__ad turn-strip-idle__ad--basic">
              Nav &amp; radar — <strong>Plus</strong> adds traffic, advisory map, and route tools.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
