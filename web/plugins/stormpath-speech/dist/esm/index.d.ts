export type SpeakOptions = {
  text: string;
  interrupt?: boolean;
  rate?: number;
  /** BCP-47 tag. Omitted calls keep the English voice Stormy already uses. */
  language?: string;
  /** Prefer a downloaded enhanced voice such as Ava, when the phone has one. */
  preferEnhanced?: boolean;
};

export type SpeakResult = {
  spoke: boolean;
  reason?: string;
};

export interface StormpathSpeechPlugin {
  speak(options: SpeakOptions): Promise<SpeakResult>;
  stop(): Promise<void>;
  isSpeaking(): Promise<{ speaking: boolean }>;
  /** One spoken remark. On iPhone this uses on-device recognition. */
  listen(): Promise<{ text: string }>;
}

export declare const StormpathSpeech: StormpathSpeechPlugin;
