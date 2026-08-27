import { useEffect, useRef, useState } from "react";
import { reportJeffSighting, subscribeJeffSightings } from "./jeffTheBot";
import { isCoachmarkStepSeen, markCoachmarkStepSeen } from "./coachmarks/firstLaunchSteps";

/** How long Jeff stays full-color after a fix before fading back. */
const ACTIVE_MS = 4_000;
/** Reuses the generic per-id "seen" storage the guided-tour coachmarks use. */
const INTRO_SEEN_ID = "jeff-the-fixit-bot-intro";

const JEFF_DISPLAY_NAME = "Jeff the Fix-It Bot";

export type JeffBadgeProps = {
  /** While true, show a dim, always-there Jeff icon during drive + GO even before any
   *  auto-fix has ever happened, so the manual camera-fix tap target is discoverable. */
  manualCameraFixAvailable?: boolean;
  /** Tapping Jeff calls this — hard-resyncs the follow-cam only. Doesn't run any of Jeff's
   *  other background checks (live traffic, etc.). */
  onManualCameraFix?: () => void;
};

/**
 * Tiny corner mascot for the supervisor's drive-map crew (Jeff). Goes full color
 * for a few seconds after an auto-fix — no popup copy, so he stays out of the way.
 *
 * When `manualCameraFixAvailable` is set (drive view + GO), Jeff also stays visible at low
 * opacity as a tap target for a manual camera resync.
 */
export function JeffBadge({
  manualCameraFixAvailable = false,
  onManualCameraFix,
}: JeffBadgeProps) {
  const [active, setActive] = useState(false);
  const [hasSighted, setHasSighted] = useState(false);
  const hideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return subscribeJeffSightings(() => {
      if (!isCoachmarkStepSeen(INTRO_SEEN_ID)) markCoachmarkStepSeen(INTRO_SEEN_ID);
      setHasSighted(true);
      setActive(true);
      if (hideTimerRef.current != null) window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = window.setTimeout(() => setActive(false), ACTIVE_MS);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current != null) window.clearTimeout(hideTimerRef.current);
    };
  }, []);

  const canManualFix = manualCameraFixAvailable && Boolean(onManualCameraFix);
  if (!hasSighted && !canManualFix) return null;

  const handleActivate = () => {
    if (!onManualCameraFix) return;
    onManualCameraFix();
    // Same pub/sub as automatic fixes — Control Room log + full-color flash, no message.
    reportJeffSighting("drive_camera", "You straightened out the map view.", true);
  };

  return (
    <div
      className={`jeff-badge${active ? " jeff-badge--active" : ""}`}
      role={onManualCameraFix ? "button" : "status"}
      aria-live="off"
      tabIndex={onManualCameraFix ? 0 : undefined}
      title={onManualCameraFix ? "Tap to straighten the drive camera" : undefined}
      onClick={handleActivate}
      onKeyDown={
        onManualCameraFix
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleActivate();
              }
            }
          : undefined
      }
    >
      <img
        className="jeff-badge__avatar"
        src="/icons/jeff-bot.png"
        alt={JEFF_DISPLAY_NAME}
        width={34}
        height={34}
      />
    </div>
  );
}
