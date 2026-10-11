import { Capacitor } from "@capacitor/core";
import { StormpathSpeech } from "@stormpath/speech";

type SpeechResultEvent = { results?: ArrayLike<ArrayLike<{ transcript?: string }>> };

type BrowserRecognizer = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function browserRecognizer(): BrowserRecognizer | null {
  const w = window as Window & {
    SpeechRecognition?: new () => BrowserRecognizer;
    webkitSpeechRecognition?: new () => BrowserRecognizer;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Stormy could not hear that.")), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error("Stormy could not hear that."));
      }
    );
  });
}

/** Hear one short remark. On iPhone this stays on the device. */
export async function listenForStormy(): Promise<string> {
  if (Capacitor.isNativePlatform()) {
    const result = await withTimeout(StormpathSpeech.listen(), 12_000);
    return (result.text ?? "").replace(/\s+/g, " ").trim();
  }
  const recognition = browserRecognizer();
  if (!recognition) throw new Error("This phone cannot hear Stormy yet.");
  return await new Promise<string>((resolve, reject) => {
    let text = "";
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      text = event.results?.[0]?.[0]?.transcript ?? "";
    };
    recognition.onerror = () => reject(new Error("Stormy could not hear that."));
    recognition.onend = () => resolve(text.replace(/\s+/g, " ").trim());
    try {
      recognition.start();
    } catch {
      reject(new Error("Stormy could not hear that."));
    }
  });
}
