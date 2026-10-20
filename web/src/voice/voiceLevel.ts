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

/** The old assistant radio turns the switch on until the driver saves the new switch. */
export function assistantEnabledFromLegacy(
  savedVoice: string | null | undefined,
  savedFlag: string | null | undefined
): boolean {
  if (savedFlag === "1" || savedFlag === "true") return true;
  if (savedFlag === "0" || savedFlag === "false") return false;
  return savedVoice === "assistant";
}

export function voiceSpeaks(level: VoiceLevel): boolean {
  return level !== "off";
}

/**
 * Downloaded voice does not turn the assistant off. It only asks the phone
 * to speak his replies with a male voice the driver downloaded. Stormy stays
 * on the phone's usual voice, so the two do not sound the same.
 */
export function speechVoiceFlags(
  level: VoiceLevel,
  forAssistant: boolean
): { forAssistant?: boolean } {
  if (level === "enhanced" && forAssistant) return { forAssistant: true };
  return {};
}

export function stormyButtonFor(level: VoiceLevel, assistantEnabled: boolean): boolean {
  return !assistantEnabled && (level === "basic" || level === "enhanced");
}

/** The name on the map button. Grok does not hand its custom name over, so the driver types it. */
export function assistantButtonLabel(name: string): string {
  const cleaned = name.replace(/\s+/g, " ").trim().slice(0, 16);
  return cleaned || "Grok";
}
