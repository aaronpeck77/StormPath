import { Capacitor } from "@capacitor/core";
import { StormpathSpeech } from "@stormpath/speech";
import { useSettingsStore } from "../state/settingsStore";
import { speechVoiceFlags } from "../voice/voiceLevel";

/** Speak a short advisory / alert line. Never cancels Mapbox turn voice (interrupt defaults false). */
export async function speakStormpathLine(
  text: string,
  opts?: { enabled?: boolean; interrupt?: boolean; language?: string; forAssistant?: boolean }
): Promise<boolean> {
  if (opts?.enabled === false) return false;
  const line = text.replace(/\s+/g, " ").trim();
  if (!line) return false;
  try {
    const flags = speechVoiceFlags(useSettingsStore.getState().voiceLevel, opts?.forAssistant === true);
    const r = await StormpathSpeech.speak({
      text: line,
      interrupt: opts?.interrupt ?? false,
      ...(opts?.language ? { language: opts.language } : {}),
      ...flags,
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

/**
 * A turn instruction keeps the floor. Wait while one is close or StormPath is already speaking,
 * then give up so a reply is not held for the whole drive.
 */
export async function waitUntilTurnFloor(turnImminent: () => boolean, maxMs = 12_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const busy = await isStormpathSpeechBusy();
    if (!busy && !turnImminent()) return;
    await new Promise((resolve) => window.setTimeout(resolve, 250));
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
