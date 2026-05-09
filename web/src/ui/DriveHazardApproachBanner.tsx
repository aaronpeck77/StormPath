import type { RouteImpact } from "../nav/routeImpacts";
import type { DriveApproachBannerPhase } from "../nav/driveHazardApproachPreview";
import { approachBannerTitle } from "../nav/driveHazardApproachPreview";

type Props = {
  phase: DriveApproachBannerPhase;
  impact: RouteImpact;
  /** Open the bypass-compare flow (single tap target — replaces the old Info / Bypass split). */
  onPlanAround: (impact: RouteImpact) => void;
  onDismiss: () => void;
  /** Disable the row while we're already fetching alternates (banner can't fire twice). */
  busy?: boolean;
};

/**
 * Slim row under the advisory stack — banner is now a single tap target that opens the
 * A/B/C bypass-compare flow (drops the old `ℹ Info → advisory page` detour). Only fires for
 * road events with a real reroute action; weather is left to the advisory bar.
 */
export function DriveHazardApproachBanner({
  phase,
  impact,
  onPlanAround,
  onDismiss,
  busy = false,
}: Props) {
  const title = approachBannerTitle(impact);
  const early = phase === "early";

  const rootClass = [
    "drive-hazard-approach",
    "drive-hazard-approach--strip",
    early ? "drive-hazard-approach--early" : "drive-hazard-approach--near",
    `drive-hazard-approach--sev-${impact.severity}`,
  ].join(" ");

  return (
    <div
      className={rootClass}
      role="alertdialog"
      aria-labelledby="drive-hazard-approach-title"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        if (busy) return;
        onPlanAround(impact);
      }}
    >
      <div className="drive-hazard-approach__copy">
        <p
          id="drive-hazard-approach-title"
          className={`drive-hazard-approach__title${early ? " drive-hazard-approach__title--early" : ""}`}
        >
          {title}
        </p>
        <p className="drive-hazard-approach__hint">
          {busy ? "Checking alternates…" : "Tap to plan around it"}
        </p>
      </div>
      <div className="drive-hazard-approach__strip-actions">
        <button
          type="button"
          className="drive-hazard-approach__chip drive-hazard-approach__chip--icon"
          aria-label="Dismiss"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
}
