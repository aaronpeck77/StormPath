import type { RouteImpact } from "../nav/routeImpacts";
import {
  approachBannerShowsBypass,
  approachBannerTitle,
} from "../nav/driveHazardApproachPreview";

type Props = {
  impact: RouteImpact;
  onDismiss: () => void;
  onMoreInfo: (impact: RouteImpact) => void;
  onBypass?: () => void;
  bypassBusy?: boolean;
  showBypass: boolean;
};

export function DriveHazardApproachBanner({
  impact,
  onDismiss,
  onMoreInfo,
  onBypass,
  bypassBusy = false,
  showBypass,
}: Props) {
  const title = approachBannerTitle(impact);
  const showBypassBtn = Boolean(showBypass && onBypass);

  return (
    <div
      className={`drive-hazard-approach drive-hazard-approach--sev-${impact.severity}`}
      role="alertdialog"
      aria-labelledby="drive-hazard-approach-title"
      aria-describedby="drive-hazard-approach-desc"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        onMoreInfo(impact);
      }}
    >
      <div className="drive-hazard-approach__main">
        <p id="drive-hazard-approach-title" className="drive-hazard-approach__title">
          {title}
        </p>
        <p id="drive-hazard-approach-desc" className="drive-hazard-approach__hint">
          {approachBannerShowsBypass(impact)
            ? "Ahead on your route — options below."
            : "Ahead on your route — tap Details for more."}
        </p>
      </div>
      <div className="drive-hazard-approach__actions">
        {showBypassBtn ? (
          <button
            type="button"
            className="drive-hazard-approach__btn drive-hazard-approach__btn--bypass"
            onClick={(e) => {
              e.stopPropagation();
              onBypass?.();
            }}
            disabled={bypassBusy}
          >
            {bypassBusy ? "Checking…" : "Bypass"}
          </button>
        ) : null}
        <button
          type="button"
          className="drive-hazard-approach__btn drive-hazard-approach__btn--secondary"
          onClick={(e) => {
            e.stopPropagation();
            onMoreInfo(impact);
          }}
        >
          Details
        </button>
        <button
          type="button"
          className="drive-hazard-approach__btn drive-hazard-approach__btn--close"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
}
