import { WebPlugin } from "@capacitor/core";

/** Browser / Netlify: native Core is unavailable; DIY nav stays in the app. */
export class StormpathMapboxNavigationWeb extends WebPlugin {
  async isAvailable() {
    return { available: false };
  }

  async startActiveGuidance() {
    return { ok: false, message: "Native Mapbox Navigation Core is iOS-only." };
  }

  async stop() {}
}
