import { useEffect, useRef, useState } from "react";
import { subscribeJeffSightings, type JeffSighting } from "./jeffTheBot";
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
  live_traffic: "live traffic",
};

/**
 * Tiny always-there corner mascot for the background watchdogs (see `useDriveCameraHealth`,
 * `useLiveTrafficHealth`). Invisible almost all the time; lights up for a few seconds whenever
 * a watchdog catches and auto-corrects something, so the fixes aren't completely invisible to
 * the driver. Purely cosmetic — never blocks input, never appears while nothing has happened.
 */
export function JeffBadge() {
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

  if (!sighting) return null;

  return (
    <div
      className={`jeff-badge${expanded ? " jeff-badge--active" : ""}`}
      role="status"
      aria-live="polite"
      onClick={() => setExpanded((v) => !v)}
    >
      <img className="jeff-badge__avatar" src="/icons/jeff-bot.png" alt={JEFF_DISPLAY_NAME} width={34} height={34} />
      {expanded && (
        <div className="jeff-badge__note">
          <div className="jeff-badge__title">{JEFF_DISPLAY_NAME}</div>
          {isIntro ? (
            <div className="jeff-badge__body">
              He quietly checks things like the drive camera and live traffic in the background
              and fixes them automatically. Just now: fixed the {DOMAIN_LABEL[sighting.domain]}.
            </div>
          ) : (
            <div className="jeff-badge__body">Fixed the {DOMAIN_LABEL[sighting.domain]}.</div>
          )}
        </div>
      )}
    </div>
  );
}
