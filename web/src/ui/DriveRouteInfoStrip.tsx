import type { DriveAheadLine, DriveAheadRadarTier } from "../nav/driveRouteAhead";
import { formatDriveAheadBrief } from "../nav/driveRouteAhead";

type Props = {
  /** When set, shows loading/work state instead of route-ahead (no idle-only row in drive). */
  busyLabel: string | null;
  routeLine: DriveAheadLine | null;
  onOpenDetails: () => void;
  advisoryExpanded: boolean;
};

const radarClass: Record<DriveAheadRadarTier, string> = {
  clear: "drive-route-info-strip--radar-clear",
  blue: "drive-route-info-strip--radar-blue",
  green: "drive-route-info-strip--radar-green",
  yellow: "drive-route-info-strip--radar-yellow",
  orange: "drive-route-info-strip--radar-orange",
  red: "drive-route-info-strip--radar-red",
};

function trunc(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/**
 * Drive mode: route-ahead hazards only (full advisory lives on Hazards control / panel).
 */
export function DriveRouteInfoStrip({
  busyLabel,
  routeLine,
  onOpenDetails,
  advisoryExpanded,
}: Props) {
  const busy = busyLabel != null;
  if (!busy && !routeLine) return null;

  const tier: DriveAheadRadarTier = busy ? "clear" : routeLine!.radarTier;

  const fullTitle = busy ? busyLabel! : routeLine!.text;

  return (
    <button
      type="button"
      className={`drive-route-info-strip ${busy ? "drive-route-info-strip--busy" : radarClass[tier] ?? ""}`.trim()}
      onPointerDownCapture={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onOpenDetails();
      }}
      title={fullTitle}
      aria-expanded={advisoryExpanded}
      aria-controls="storm-advisory-panel"
      aria-label={busy ? busyLabel! : routeLine!.text}
    >
      {busy ? (
        <>
          <span className="drive-route-info-strip__dot" aria-hidden />
          <span className="drive-route-info-strip__primary">{trunc(busyLabel!, 48)}</span>
        </>
      ) : (
        <>
          <span className="drive-route-info-strip__icon" aria-hidden>
            ◈
          </span>
          <span className="drive-route-info-strip__primary">{formatDriveAheadBrief(routeLine!)}</span>
        </>
      )}
    </button>
  );
}
