import { useEffect, useRef, useState } from "react";

const WINDOW_MS = 30_000;
const SAMPLE_MS = 1_000;
/** Ignore near-stops and GPS spikes when building a cruise median. */
const MIN_CRUISE_MPH = 18;
const MAX_CRUISE_MPH = 90;
/** Need this many recent moving samples before cruise is trusted. */
const MIN_SAMPLES = 12;

type Sample = { atMs: number; mph: number };

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}

/**
 * Rolling median of GPS speed while navigating — hint for posted-limit sanity,
 * not a substitute for road signs.
 */
export function useCruiseSpeedHintMph(
  navigationStarted: boolean,
  speedMph: number | null
): number | null {
  const samplesRef = useRef<Sample[]>([]);
  const [cruiseMph, setCruiseMph] = useState<number | null>(null);

  useEffect(() => {
    if (!navigationStarted) {
      samplesRef.current = [];
      setCruiseMph(null);
      return;
    }

    const tick = () => {
      const now = Date.now();
      const mph = speedMph;
      if (mph != null && Number.isFinite(mph) && mph >= MIN_CRUISE_MPH && mph <= MAX_CRUISE_MPH) {
        samplesRef.current.push({ atMs: now, mph });
      }
      samplesRef.current = samplesRef.current.filter((s) => now - s.atMs <= WINDOW_MS);
      const recent = samplesRef.current.map((s) => s.mph);
      if (recent.length < MIN_SAMPLES) {
        setCruiseMph(null);
        return;
      }
      setCruiseMph(median(recent));
    };

    tick();
    const id = window.setInterval(tick, SAMPLE_MS);
    return () => window.clearInterval(id);
  }, [navigationStarted, speedMph]);

  return cruiseMph;
}
