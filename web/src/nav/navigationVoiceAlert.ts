/** One-shot navigation alerts (off-route detour, back on route) — separate from turn-by-turn voice. */
import { speakStormpathLine } from "../services/stormpathSpeech";

export function speakNavigationAlert(text: string, enabled: boolean): void {
  void speakStormpathLine(text, { enabled, interrupt: true });
}
