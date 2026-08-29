import { formatDriveAheadBrief, type DriveAheadLine } from "../nav/driveRouteAhead";

/** Pick one short phrase for advisory TTS (hazard first, then ahead, then nowcast). */
export function pickAdvisoryVoiceLine(input: {
  nextHazardAtEtaLine: string | null | undefined;
  driveRouteAheadLine: DriveAheadLine | null | undefined;
  nowcastLine: string | null | undefined;
}): string | null {
  const hazard = input.nextHazardAtEtaLine?.replace(/\s+/g, " ").trim();
  if (hazard) return hazard;

  if (input.driveRouteAheadLine) {
    const ahead = formatDriveAheadBrief(input.driveRouteAheadLine).replace(/\s+/g, " ").trim();
    if (ahead) return ahead;
  }

  const now = input.nowcastLine?.replace(/\s+/g, " ").trim();
  if (now) return now;

  return null;
}

export function shouldSpeakAdvisoryLine(input: {
  line: string | null;
  lastSpokenLine: string | null;
  lastSpokenAtMs: number | null;
  nowMs: number;
  cooldownMs: number;
}): boolean {
  if (!input.line) return false;
  if (input.line === input.lastSpokenLine) {
    if (input.lastSpokenAtMs != null && input.nowMs - input.lastSpokenAtMs < input.cooldownMs) {
      return false;
    }
    /* Same line after cooldown — skip; wait for a real change. */
    return false;
  }
  if (input.lastSpokenAtMs != null && input.nowMs - input.lastSpokenAtMs < input.cooldownMs) {
    return false;
  }
  return true;
}
