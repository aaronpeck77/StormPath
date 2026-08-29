import { registerPlugin } from "@capacitor/core";

const StormpathCarSession = registerPlugin("StormpathCarSession", {
  web: () =>
    Promise.resolve({
      async publish() {
        return { ok: true };
      },
      async clear() {},
    }),
});

export { StormpathCarSession };
