import { useEffect, useRef } from "react";
import type { DriveAheadLine } from "../nav/driveRouteAhead";
import { pickAdvisoryVoiceLine, shouldSpeakAdvisoryLine } from "../nav/advisoryVoice";
import { isStormpathSpeechBusy, speakStormpathLine } from "../services/stormpathSpeech";

/** Min gap between advisory utterances so we don't talk over Mapbox turns. */
export const ADVISORY_VOICE_COOLDOWN_MS = 75_000;

type Params = {
  enabled: boolean;
  navigationStarted: boolean;
  nextHazardAtEtaLine: string | null;
  driveRouteAheadLine: DriveAheadLine | null;
  nowcastLine: string | null;
};

/**
 * Speaks hazard / route-ahead / nowcast lines while navigating.
 * Skips when Stormpath speech is already busy; does not interrupt Mapbox turns.
 */
export function useAdvisoryVoiceGuidance(p: Params): void {
  const lastLineRef = useRef<string | null>(null);
  const lastAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!p.enabled || !p.navigationStarted) return;

    const line = pickAdvisoryVoiceLine({
      nextHazardAtEtaLine: p.nextHazardAtEtaLine,
      driveRouteAheadLine: p.driveRouteAheadLine,
      nowcastLine: p.nowcastLine,
    });
    const now = Date.now();
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
  ]);
}
