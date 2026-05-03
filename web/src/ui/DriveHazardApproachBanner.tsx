import type { RouteImpact } from "../nav/routeImpacts";
import type { DriveApproachBannerPhase } from "../nav/driveHazardApproachPreview";
import { approachBannerTitle } from "../nav/driveHazardApproachPreview";

type Props = {
  phase: DriveApproachBannerPhase;
  impact: RouteImpact;
  onDismiss: () => void;
  onMoreInfo: (impact: RouteImpact) => void;
  onBypass?: () => void;
  bypassBusy?: boolean;
  showBypass: boolean;
};

/** One slim row under the advisory stack — does not stack a second text block. */
export function DriveHazardApproachBanner({
  phase,
  impact,
  onDismiss,
  onMoreInfo,
  onBypass,
  bypassBusy = false,
  showBypass,
}: Props) {
  const title = approachBannerTitle(impact);
  const showBypassBtn = phase === "near" && Boolean(showBypass && onBypass);
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
      role={early ? "alert" : "alertdialog"}
      aria-label={early ? title : undefined}
      aria-labelledby={early ? undefined : "drive-hazard-approach-title"}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        onMoreInfo(impact);
      }}
    >
      <p
        id={early ? undefined : "drive-hazard-approach-title"}
        className={`drive-hazard-approach__title${early ? " drive-hazard-approach__title--early" : ""}`}
      >
        {title}
      </p>
      <div className="drive-hazard-approach__strip-actions">
        {showBypassBtn ? (
          <button
            type="button"
            className="drive-hazard-approach__chip drive-hazard-approach__chip--bypass"
            onClick={(e) => {
              e.stopPropagation();
              onBypass?.();
            }}
            disabled={bypassBusy}
          >
            {bypassBusy ? "…" : "Bypass"}
          </button>
        ) : null}
        {!early ? (
          <button
            type="button"
            className="drive-hazard-approach__chip drive-hazard-approach__chip--icon"
            aria-label="Details"
            title="Details"
            onClick={(e) => {
              e.stopPropagation();
              onMoreInfo(impact);
            }}
          >
            <span className="drive-hazard-approach__glyph" aria-hidden>
              ℹ
            </span>
          </button>
        ) : null}
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
