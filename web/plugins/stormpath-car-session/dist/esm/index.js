import { registerPlugin } from "@capacitor/core";

const StormpathCarSession = registerPlugin("StormpathCarSession", {
  web: () =>
    Promise.resolve({
      async publish() {
        return { ok: true };
      },
      async clear() {},
      async carPlayConnected() {
        return { connected: false, detached: false };
      },
      async carPlayHazardAlert() {
        return { titles: [], at: 0 };
      },
    }),
});

export { StormpathCarSession };
