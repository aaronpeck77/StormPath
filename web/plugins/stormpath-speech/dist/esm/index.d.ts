export type SpeakOptions = {
  text: string;
  interrupt?: boolean;
  rate?: number;
  /** BCP-47 tag. Omitted calls keep the English voice Stormy already uses. */
  language?: string;
  /** Use an installed Enhanced or Premium voice. A Siri voice cannot be used. */
  preferEnhanced?: boolean;
  /** The assistant's reply. Use a downloaded male voice, not Stormy's voice. */
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
