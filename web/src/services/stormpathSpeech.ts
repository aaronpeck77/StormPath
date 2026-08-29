import { Capacitor } from "@capacitor/core";
import { StormpathSpeech } from "@stormpath/speech";

/** Speak a short advisory / alert line. Never cancels Mapbox turn voice (interrupt defaults false). */
export async function speakStormpathLine(
  text: string,
  opts?: { enabled?: boolean; interrupt?: boolean }
): Promise<boolean> {
  if (opts?.enabled === false) return false;
  const line = text.replace(/\s+/g, " ").trim();
  if (!line) return false;
  try {
    const r = await StormpathSpeech.speak({
      text: line,
      interrupt: opts?.interrupt ?? false,
    });
    return Boolean(r?.spoke);
  } catch {
    return false;
  }
}

export async function stopStormpathSpeech(): Promise<void> {
  try {
    await StormpathSpeech.stop();
  } catch {
    /* ignore */
  }
}

export async function isStormpathSpeechBusy(): Promise<boolean> {
  try {
    const r = await StormpathSpeech.isSpeaking();
    return Boolean(r?.speaking);
  } catch {
    return false;
  }
}

export function isNativeStormpathSpeech(): boolean {
  return Capacitor.isNativePlatform();
}
