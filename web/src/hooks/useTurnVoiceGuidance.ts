import { useEffect, useRef } from "react";

type Params = {
  enabled: boolean;
  navigating: boolean;
  activeTurnIndex: number;
  instruction: string;
  metersToManeuverEnd: number | null | undefined;
  /** When the active guidance leg changes (reroute / promote), reset speak memory. */
  routeLegId: string;
};

/**
 * Hands-free spoken maneuvers while navigating (Web Speech API), any map view.
 * Speaks when the step index changes, and once more when very close (“Now…”).
 */
export function useTurnVoiceGuidance(p: Params): void {
  const lastLegRef = useRef("");
  const lastFullSpeakIdx = useRef(-1);
  const spokeProximityForIdx = useRef<number | null>(null);

  useEffect(() => {
    if (p.routeLegId !== lastLegRef.current) {
      lastLegRef.current = p.routeLegId;
      lastFullSpeakIdx.current = -999;
      spokeProximityForIdx.current = null;
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

    const indexChanged = idx !== lastFullSpeakIdx.current;
    if (indexChanged) {
      lastFullSpeakIdx.current = idx;
      spokeProximityForIdx.current = null;
      let prefix = "";
      if (m != null && Number.isFinite(m) && m > 15) {
        const ft = m * 3.28084;
        if (ft < 750) {
          prefix = `In about ${Math.round(ft)} feet, `;
        } else {
          const mi = m / 1609.34;
          prefix = mi < 10 ? `In about ${mi.toFixed(1)} miles, ` : `In about ${Math.round(mi)} miles, `;
        }
      }
      speak(prefix + text);
      return;
    }

    if (m != null && Number.isFinite(m) && m < 80 && spokeProximityForIdx.current !== idx) {
      spokeProximityForIdx.current = idx;
      speak(`Now. ${text}`);
    }
  }, [
    p.enabled,
    p.navigating,
    p.activeTurnIndex,
    p.instruction,
    p.metersToManeuverEnd,
    p.routeLegId,
  ]);
}
