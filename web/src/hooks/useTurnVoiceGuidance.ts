import { useEffect, useRef } from "react";
import {
  formatVoiceDistancePrefix,
  voiceBandOrdinal,
  voiceBandToSpeak,
  voiceManeuverThresholds,
} from "../nav/voiceManeuverTiming";

type Params = {
  enabled: boolean;
  navigating: boolean;
  activeTurnIndex: number;
  instruction: string;
  metersToManeuverEnd: number | null | undefined;
  speedMps?: number | null;
  /** When the active guidance leg changes (reroute / promote), reset speak memory. */
  routeLegId: string;
};

/**
 * Hands-free spoken maneuvers while navigating (Web Speech API).
 * Speaks once per distance band (early → medium → close → now), scaled to speed.
 */
export function useTurnVoiceGuidance(p: Params): void {
  const lastLegRef = useRef("");
  const lastTurnIndexRef = useRef(-1);
  /** Highest band ordinal already spoken for each turn step index. */
  const spokeBandOrdinalRef = useRef<Map<number, number>>(new Map());

  useEffect(() => {
    if (p.routeLegId !== lastLegRef.current) {
      lastLegRef.current = p.routeLegId;
      lastTurnIndexRef.current = -1;
      spokeBandOrdinalRef.current = new Map();
    }
  }, [p.routeLegId]);

  useEffect(() => {
    if (!p.enabled || !p.navigating) {
      try {
        window.speechSynthesis?.cancel();
      } catch {
        /* ignore */
      }
      return;
    }

    const text = p.instruction.replace(/\s+/g, " ").trim();
    if (!text) return;

    if (typeof window === "undefined" || !window.speechSynthesis) return;

    const speak = (phrase: string) => {
      try {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(phrase);
        u.rate = 1;
        u.pitch = 1;
        window.speechSynthesis.speak(u);
      } catch {
        /* ignore */
      }
    };

    const idx = p.activeTurnIndex;
    const m = p.metersToManeuverEnd;
    if (m == null || !Number.isFinite(m)) return;

    const stepIndexChanged = idx !== lastTurnIndexRef.current;
    if (stepIndexChanged) {
      lastTurnIndexRef.current = idx;
      spokeBandOrdinalRef.current.delete(idx);
    }

    const thresholds = voiceManeuverThresholds(p.speedMps);
    const band = voiceBandToSpeak(m, thresholds, stepIndexChanged);
    if (!band) return;

    const bandOrd = voiceBandOrdinal(band);
    const lastSpokenOrd = spokeBandOrdinalRef.current.get(idx) ?? -1;
    if (bandOrd <= lastSpokenOrd) return;

    spokeBandOrdinalRef.current.set(idx, bandOrd);
    const prefix = formatVoiceDistancePrefix(m, band);
    speak(prefix + text);
  }, [
    p.enabled,
    p.navigating,
    p.activeTurnIndex,
    p.instruction,
    p.metersToManeuverEnd,
    p.speedMps,
    p.routeLegId,
  ]);
}
