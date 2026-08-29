import { registerPlugin } from "@capacitor/core";

/**
 * @typedef {{ activity: string, confidence: number | null }} DeviceMotionActivityResult
 * @typedef {{
 *   start: () => Promise<{ ok: boolean }>,
 *   stop: () => Promise<void>,
 *   getCurrent: () => Promise<DeviceMotionActivityResult>,
 * }} StormpathDeviceMotionPlugin
 */

/** @type {import('@capacitor/core').RegisterPluginResult<any>} */
const StormpathDeviceMotion = registerPlugin("StormpathDeviceMotion", {
  web: () =>
    Promise.resolve({
      async start() {
        return { ok: false };
      },
      async stop() {},
      async getCurrent() {
        return { activity: "unknown", confidence: null };
      },
    }),
});

export { StormpathDeviceMotion };
