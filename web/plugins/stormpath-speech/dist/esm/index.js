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
          if (opts?.language) u.lang = String(opts.language);
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
      async listen() {
        const w = window;
        const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
        if (!Ctor) return { text: "" };
        return await new Promise((resolve) => {
          const recognition = new Ctor();
          let text = "";
          recognition.lang = "en-US";
          recognition.interimResults = false;
          recognition.continuous = false;
          recognition.onresult = (event) => {
            text = event.results?.[0]?.[0]?.transcript || "";
          };
          recognition.onerror = () => resolve({ text: "" });
          recognition.onend = () => resolve({ text: String(text).trim() });
          try {
            recognition.start();
          } catch {
            resolve({ text: "" });
          }
        });
      },
    }),
});

export { StormpathSpeech };
