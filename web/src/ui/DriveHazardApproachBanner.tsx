import type { RouteImpact } from "../nav/routeImpacts";
import type { DriveApproachBannerPhase } from "../nav/driveHazardApproachPreview";
import { approachBannerTitle } from "../nav/driveHazardApproachPreview";

type Props = {
  phase: DriveApproachBannerPhase;
  impact: RouteImpact;
  /** When false, banner is info-only (no bypass / compare tap target). */
  rerouteEnabled?: boolean;
  /** Open the bypass-compare flow (single tap target — replaces the old Info / Bypass split). */
  onPlanAround: (impact: RouteImpact) => void;
  onDismiss: () => void;
  /** Disable the row while we're already fetching alternates (banner can't fire twice). */
  busy?: boolean;
};

/**
 * Slim row under the advisory stack — when reroute is enabled, a single tap opens the
 * A/B/C bypass-compare flow. When disabled, shows slowdown copy only (dismiss still works).
 */
export function DriveHazardApproachBanner({
  phase,
  impact,
  rerouteEnabled = false,
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
    rerouteEnabled ? "drive-hazard-approach--actionable" : "drive-hazard-approach--info-only",
  ].join(" ");

  const hint = busy
    ? "Checking alternates…"
    : rerouteEnabled
      ? "Tap to plan around it"
      : "Consider an alternate route when you can — in-app reroute isn't available yet.";

  return (
    <div
      className={rootClass}
      role="alertdialog"
      aria-labelledby="drive-hazard-approach-title"
      onClick={(e) => {
        if (!rerouteEnabled) return;
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
        <p className="drive-hazard-approach__hint">{hint}</p>
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
