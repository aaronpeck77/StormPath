import { useEffect, useRef, useState } from "react";
import { reportJeffSighting, subscribeJeffSightings, type JeffSighting } from "./jeffTheBot";
import { isCoachmarkStepSeen, markCoachmarkStepSeen } from "./coachmarks/firstLaunchSteps";

/** How long the popup note stays up before fading back out. */
const VISIBLE_MS = 7_000;
/** First-ever sighting gets extra time on screen since there's more to read. */
const INTRO_VISIBLE_MS = 13_000;
/** Reuses the generic per-id "seen" storage the guided-tour coachmarks use. */
const INTRO_SEEN_ID = "jeff-the-fixit-bot-intro";

const JEFF_DISPLAY_NAME = "Jeff the Fix-It Bot";

const DOMAIN_LABEL: Record<JeffSighting["domain"], string> = {
  drive_camera: "map view",
  drive_puck: "drive puck",
  live_traffic: "live traffic",
};

export type JeffBadgeProps = {
  /** While true, show a dim, always-there Jeff icon during drive + GO even before any
   *  auto-fix has ever happened, so the manual camera-fix tap target is discoverable. */
  manualCameraFixAvailable?: boolean;
  /** Tapping Jeff calls this — hard-resyncs the follow-cam only. Doesn't run any of Jeff's
   *  other background checks (live traffic, etc.). */
  onManualCameraFix?: () => void;
};

/**
 * Tiny corner mascot for the background watchdogs (see `useDriveCameraHealth`,
 * `useLiveTrafficHealth`). Lights up for a few seconds whenever a watchdog catches and
 * auto-corrects something, so the fixes aren't completely invisible to the driver.
 *
 * When `manualCameraFixAvailable` is set (drive view + GO), Jeff also stays visible at low
 * opacity as a tap target: if the automatic follow-cam watchdog ever misses a sideways camera
 * or a puck that has slid off its yard-line, the driver can tap Jeff to force the same
 * camera resync themselves.
 */
export function JeffBadge({
  manualCameraFixAvailable = false,
  onManualCameraFix,
}: JeffBadgeProps) {
  const [sighting, setSighting] = useState<JeffSighting | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [isIntro, setIsIntro] = useState(false);
  const hideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return subscribeJeffSightings((next) => {
      const firstEver = !isCoachmarkStepSeen(INTRO_SEEN_ID);
      if (firstEver) markCoachmarkStepSeen(INTRO_SEEN_ID);

      setSighting(next);
      setExpanded(true);
      setIsIntro(firstEver);
      if (hideTimerRef.current != null) window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = window.setTimeout(
        () => setExpanded(false),
        firstEver ? INTRO_VISIBLE_MS : VISIBLE_MS
      );
    });
  }, []);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current != null) window.clearTimeout(hideTimerRef.current);
    };
  }, []);

  const canManualFix = manualCameraFixAvailable && Boolean(onManualCameraFix);
  if (!sighting && !canManualFix) return null;

  const handleActivate = () => {
    if (onManualCameraFix) {
      onManualCameraFix();
      // Routes through the same pub/sub as automatic fixes (this component's own
      // subscription above picks it up and updates sighting/expanded/timer), so manual taps
      // are logged for the Control Room exactly like watchdog repairs are.
      reportJeffSighting("drive_camera", "You straightened out the map view.", true);
      return;
    }
    setExpanded((v) => !v);
  };

  return (
    <div
      className={`jeff-badge${expanded ? " jeff-badge--active" : ""}`}
      role={onManualCameraFix ? "button" : "status"}
      aria-live="polite"
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
      {expanded && sighting && (
        <div className="jeff-badge__note">
          <div className="jeff-badge__title">{JEFF_DISPLAY_NAME}</div>
          {sighting.manual ? (
            <div className="jeff-badge__body">
              Straightened the map view. Tap me anytime it drifts.
            </div>
          ) : isIntro ? (
            <div className="jeff-badge__body">
              He quietly checks things like the drive camera, puck placement, and live traffic in
              the background and fixes them automatically. Just now: fixed the{" "}
              {DOMAIN_LABEL[sighting.domain]}.
              {onManualCameraFix ? " Tap me anytime to straighten the camera yourself." : null}
            </div>
          ) : (
            <div className="jeff-badge__body">
              Fixed the {DOMAIN_LABEL[sighting.domain]}.
              {onManualCameraFix ? " Tap me anytime to straighten the camera yourself." : null}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
