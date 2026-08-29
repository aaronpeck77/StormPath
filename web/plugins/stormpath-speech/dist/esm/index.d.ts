export type SpeakOptions = {
  text: string;
  interrupt?: boolean;
  rate?: number;
};

export type SpeakResult = {
  spoke: boolean;
  reason?: string;
};

export interface StormpathSpeechPlugin {
  speak(options: SpeakOptions): Promise<SpeakResult>;
  stop(): Promise<void>;
  isSpeaking(): Promise<{ speaking: boolean }>;
}

export declare const StormpathSpeech: StormpathSpeechPlugin;
