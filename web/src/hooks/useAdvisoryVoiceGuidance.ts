import { useEffect, useRef, useState } from "react";
import type { DriveAheadLine } from "../nav/driveRouteAhead";
import {
  ADVISORY_AFTER_GO_MS,
  advisoryVoiceBlocked,
  pickAdvisoryVoiceLine,
  shouldSpeakAdvisoryLine,
} from "../nav/advisoryVoice";
import { PASSENGER_TURN_QUIET_M } from "../nav/passengerAdvisory";
import { isStormpathSpeechBusy, speakStormpathLine } from "../services/stormpathSpeech";

/** Min gap between advisory utterances so we don't talk over Mapbox turns. */
export const ADVISORY_VOICE_COOLDOWN_MS = 75_000;

type Params = {
  enabled: boolean;
  navigationStarted: boolean;
  nextHazardAtEtaLine: string | null;
  driveRouteAheadLine: DriveAheadLine | null;
  nowcastLine: string | null;
  /** Meters to the next maneuver. A close turn keeps the hazard line quiet. */
  metersToManeuver?: number | null;
};

/**
 * Speaks hazard / route-ahead / nowcast lines while navigating.
 * Skips when Stormpath speech is already busy; does not interrupt Mapbox turns.
 */
export function useAdvisoryVoiceGuidance(p: Params): void {
  const lastLineRef = useRef<string | null>(null);
  const lastAtRef = useRef<number | null>(null);
  const navStartedAtRef = useRef<number | null>(null);
  const [holdTick, setHoldTick] = useState(0);

  useEffect(() => {
    if (!p.enabled || !p.navigationStarted) {
      navStartedAtRef.current = null;
      return;
    }
    if (navStartedAtRef.current == null) navStartedAtRef.current = Date.now();

    const line = pickAdvisoryVoiceLine({
      nextHazardAtEtaLine: p.nextHazardAtEtaLine,
      driveRouteAheadLine: p.driveRouteAheadLine,
      nowcastLine: p.nowcastLine,
    });
    const now = Date.now();
    if (
      advisoryVoiceBlocked({
        navigationStartedAtMs: navStartedAtRef.current,
        nowMs: now,
        metersToManeuver: p.metersToManeuver,
        turnQuietM: PASSENGER_TURN_QUIET_M,
      })
    ) {
      const started = navStartedAtRef.current;
      const wait = started == null ? 0 : ADVISORY_AFTER_GO_MS - (now - started);
      if (wait > 0) {
        const timer = window.setTimeout(() => setHoldTick((n) => n + 1), wait + 40);
        return () => window.clearTimeout(timer);
      }
      return;
    }
    if (
      !shouldSpeakAdvisoryLine({
        line,
        lastSpokenLine: lastLineRef.current,
        lastSpokenAtMs: lastAtRef.current,
        nowMs: now,
        cooldownMs: ADVISORY_VOICE_COOLDOWN_MS,
      })
    ) {
      return;
    }

    let cancelled = false;
    void (async () => {
      if (await isStormpathSpeechBusy()) return;
      if (cancelled || !line) return;
      const spoke = await speakStormpathLine(line, { enabled: true, interrupt: false });
      if (spoke && !cancelled) {
        lastLineRef.current = line;
        lastAtRef.current = Date.now();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    p.enabled,
    p.navigationStarted,
    p.nextHazardAtEtaLine,
    p.driveRouteAheadLine,
    p.nowcastLine,
    p.metersToManeuver,
    holdTick,
  ]);
}
