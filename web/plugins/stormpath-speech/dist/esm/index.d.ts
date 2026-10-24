export type SpeakOptions = {
  text: string;
  interrupt?: boolean;
  rate?: number;
  /** BCP-47 tag. Omitted calls keep the English voice Stormy already uses. */
  language?: string;
  /** Use an installed Enhanced or Premium voice. A Siri voice cannot be used. */
  preferEnhanced?: boolean;
  /** Speak with the voice the driver selected, not the built-in computer voice. */
  forAssistant?: boolean;
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
