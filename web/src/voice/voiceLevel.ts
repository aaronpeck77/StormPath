/** How the phone speaks. One choice. The assistant is a separate switch. */
export type VoiceLevel = "off" | "basic" | "enhanced";

export const VOICE_LEVELS: VoiceLevel[] = ["off", "basic", "enhanced"];

export function isVoiceLevel(value: string | null | undefined): value is VoiceLevel {
  return value === "off" || value === "basic" || value === "enhanced";
}

/**
 * A saved off / basic / downloaded choice stays.
 * No saved choice, including the old Stormy switch, starts on No voice.
 * The old "assistant" radio becomes No voice. The assistant switch is read separately.
 */
export function voiceLevelFromLegacy(saved: string | null | undefined): VoiceLevel {
  if (isVoiceLevel(saved)) return saved;
  return "off";
}

/** The Grok and ChatGPT dock is shelved. A saved switch stays off. */
export function assistantEnabledFromLegacy(
  _savedVoice: string | null | undefined,
  _savedFlag: string | null | undefined
): boolean {
  return false;
}

export function voiceSpeaks(level: VoiceLevel): boolean {
  return level !== "off";
}

/**
 * Downloaded voice asks the phone to speak with the Enhanced or Premium voice
 * the driver selected. It does not pick a gender. A Siri voice cannot be used.
 */
export function speechVoiceFlags(
  level: VoiceLevel,
  forAssistant: boolean
): { preferEnhanced?: boolean; forAssistant?: boolean } {
  if (level !== "enhanced") return {};
  return forAssistant ? { preferEnhanced: true, forAssistant: true } : { preferEnhanced: true };
}

/** Stormy's button is on for Basic and Downloaded voice. No voice leaves the map quiet. */
export function stormyButtonFor(level: VoiceLevel, _assistantEnabled?: boolean): boolean {
  return level === "basic" || level === "enhanced";
}

/** The name on the map button. Grok does not hand its custom name over, so the driver types it. */
export function assistantButtonLabel(name: string): string {
  const cleaned = name.replace(/\s+/g, " ").trim().slice(0, 16);
  return cleaned || "Grok";
}
