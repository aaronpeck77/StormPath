/** One-shot navigation alerts (off-route detour, back on route) — separate from turn-by-turn voice. */
export function speakNavigationAlert(text: string, enabled: boolean): void {
  if (!enabled || typeof window === "undefined") return;
  const synth = window.speechSynthesis;
  if (!synth) return;
  try {
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.volume = 1;
    synth.speak(utterance);
  } catch {
    /* TTS unavailable in some WebViews */
  }
}
