import { describe, expect, it } from "vitest";
import { IDLE_APP_EXIT_MS, shouldArmIdleExit } from "../idleAppExit";

describe("shouldArmIdleExit", () => {
  it("quits only the iPhone app when it is off screen and no drive is going", () => {
    expect(
      shouldArmIdleExit({ native: true, appForeground: false, navigationStarted: false })
    ).toBe(true);
    expect(IDLE_APP_EXIT_MS).toBe(20_000);
  });

  it("keeps a drive alive when the phone is locked", () => {
    expect(
      shouldArmIdleExit({ native: true, appForeground: false, navigationStarted: true })
    ).toBe(false);
  });

  it("does nothing while the app is on screen or on the web", () => {
    expect(
      shouldArmIdleExit({ native: true, appForeground: true, navigationStarted: false })
    ).toBe(false);
    expect(
      shouldArmIdleExit({ native: false, appForeground: false, navigationStarted: false })
    ).toBe(false);
  });
});
