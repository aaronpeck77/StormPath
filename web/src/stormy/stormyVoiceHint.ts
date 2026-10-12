/** Same directions in Settings and when a driver asks Stormy about her voice. */
export const STORMY_VOICE_HINT =
  "For a more natural voice, open iPhone Settings, Accessibility, Read and Speak, Voices, English, and download Ava or Zoe. It's free. On an older phone that list is under Spoken Content.";

export function asksAboutStormyVoice(lower: string): boolean {
  if (/\b(?:ava|zoe)\b/.test(lower) && /\b(?:voice|sound|download|speak|talk)\b/.test(lower)) return true;
  if (/\bvoice\b/.test(lower) && /\b(?:your|you|stormy|change|different|better|natural|download|settings|sound)\b/.test(lower)) {
    return true;
  }
  return /\b(?:sound more natural|more natural voice|natural voice|sound like a person|less robotic|computer voice|robot voice)\b/.test(
    lower
  );
}
