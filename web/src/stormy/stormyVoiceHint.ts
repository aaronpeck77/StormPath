/** Same directions in Settings and when a driver asks Stormy about her voice. */
export const STORMY_VOICE_HINT =
  "Downloaded voice does not turn your assistant off. He uses a male English voice you download. Open the iPhone Settings app, tap Accessibility, then Read & Speak, then Voices, then English, and download the male voice you want. The download is free. On an older phone that list is under Spoken Content. Stormy stays on the phone's usual voice. He uses the new voice the next time he speaks.";

export function asksAboutStormyVoice(lower: string): boolean {
  if (/\b(?:ava|zoe)\b/.test(lower) && /\b(?:voice|sound|download|speak|talk)\b/.test(lower)) return true;
  if (/\bvoice\b/.test(lower) && /\b(?:your|you|stormy|change|different|better|natural|download|settings|sound)\b/.test(lower)) {
    return true;
  }
  return /\b(?:sound more natural|more natural voice|natural voice|sound like a person|less robotic|computer voice|robot voice)\b/.test(
    lower
  );
}
