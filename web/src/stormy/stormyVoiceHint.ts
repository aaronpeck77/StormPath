/** Same directions in Settings and when a driver asks Stormy about her voice. */
export const STORMY_VOICE_HINT =
  "Siri voices in that menu stay inside Siri, so StormPath cannot speak them. Open the iPhone Settings app, tap Accessibility, then Read and Speak, then Voices, then English. Download the Enhanced or Premium voice you want and select it. The download is free. On an older phone that list is under Spoken Content. StormPath speaks that voice the next time it talks.";

export function asksAboutStormyVoice(lower: string): boolean {
  if (/\b(?:ava|zoe)\b/.test(lower) && /\b(?:voice|sound|download|speak|talk)\b/.test(lower)) return true;
  if (/\bvoice\b/.test(lower) && /\b(?:your|you|stormy|change|different|better|natural|download|settings|sound)\b/.test(lower)) {
    return true;
  }
  return /\b(?:sound more natural|more natural voice|natural voice|sound like a person|less robotic|computer voice|robot voice)\b/.test(
    lower
  );
}
