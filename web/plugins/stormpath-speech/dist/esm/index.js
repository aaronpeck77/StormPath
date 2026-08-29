import { registerPlugin } from "@capacitor/core";

const StormpathSpeech = registerPlugin("StormpathSpeech", {
  web: () =>
    Promise.resolve({
      async speak(opts) {
        const text = String(opts?.text ?? "").trim();
        if (!text || typeof window === "undefined" || !window.speechSynthesis) {
          return { spoke: false, reason: "unavailable" };
        }
        const interrupt = Boolean(opts?.interrupt);
        try {
          if (interrupt) window.speechSynthesis.cancel();
          else if (window.speechSynthesis.speaking) return { spoke: false, reason: "busy" };
          const u = new SpeechSynthesisUtterance(text);
          u.rate = typeof opts?.rate === "number" ? opts.rate : 1;
          window.speechSynthesis.speak(u);
          return { spoke: true };
        } catch {
          return { spoke: false, reason: "error" };
        }
      },
      async stop() {
        try {
          window.speechSynthesis?.cancel();
        } catch {
          /* ignore */
        }
      },
      async isSpeaking() {
        try {
          return { speaking: Boolean(window.speechSynthesis?.speaking) };
        } catch {
          return { speaking: false };
        }
      },
    }),
});

export { StormpathSpeech };
