import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Bundle ID must match the App ID you created in Apple Developer portal.
 * Replace "com.YOURNAME.stormpath" before running `npx cap add ios`.
 */
const config: CapacitorConfig = {
  appId: "com.aaronpeck.stormpath",
  appName: "StormPath",
  webDir: "dist",
  plugins: {
    Geolocation: {
      // iOS permissions are declared in ios/App/App/Info.plist (added automatically
      // by `npx cap add ios`).  The strings below are what iOS shows the user.
      // They are set by editing Info.plist in Xcode — no change needed here.
    },
  },
};

export default config;
