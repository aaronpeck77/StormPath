/**
 * While the driver is talking with the assistant, turn prompts and condition
 * lines stay quiet. Free talk keeps that quiet for a short stretch afterward.
 */

export type AssistantTalkKind = "free" | "trip";

let heldUntil = 0;
let talkKind: AssistantTalkKind = "trip";
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function armTimer(): void {
  if (timer != null) {
    clearTimeout(timer);
    timer = null;
  }
  const wait = heldUntil - Date.now();
  if (wait <= 0) return;
  timer = setTimeout(() => {
    timer = null;
    if (Date.now() >= heldUntil) notify();
  }, wait + 30);
}

export function noteAssistantTalk(kind: AssistantTalkKind): void {
  talkKind = kind;
}

export function voiceHoldMs(kind: AssistantTalkKind, words: number): number {
  const speech = Math.min(45_000, Math.max(1, words) * 420 + 1_500);
  return speech + (kind === "free" ? 20_000 : 1_500);
}

export function holdAppVoice(ms: number): void {
  heldUntil = Math.max(heldUntil, Date.now() + Math.max(0, ms));
  armTimer();
  notify();
}

export function holdForSpokenReply(text: string): void {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  holdAppVoice(voiceHoldMs(talkKind, words));
}

export function releaseAppVoice(): void {
  heldUntil = 0;
  if (timer != null) {
    clearTimeout(timer);
    timer = null;
  }
  notify();
}

export function isAppVoiceHeld(): boolean {
  return Date.now() < heldUntil;
}

export function subscribeAppVoiceHold(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
