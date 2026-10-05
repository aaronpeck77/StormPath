import { describe, expect, it } from "vitest";
import { reloadPersistedSettings, useSettingsStore } from "../../state/settingsStore";
import { __resetSafeStorageForTests, safeStorage } from "../../storage/safeStorage";
import { applyPuckColor, puckColorById } from "../puckColor";

describe("puckColorById", () => {
  it("keeps blue when nothing is saved", () => {
    expect(puckColorById(null).id).toBe("blue");
    expect(puckColorById("nope").label).toBe("Blue");
  });

  it("knows a color that stands off the blue route line", () => {
    expect(puckColorById("orange").fill).toBe("#f97316");
    expect(puckColorById("white").stroke).toBe("#0f172a");
  });

  it("does nothing when there is no page yet", () => {
    expect(() => applyPuckColor("gold")).not.toThrow();
  });
});

describe("reloadPersistedSettings", () => {
  it("picks up a puck color saved before the store was created", () => {
    __resetSafeStorageForTests();
    useSettingsStore.setState({ puckColor: "blue" });
    safeStorage.set("stormpath-setting-puck-color", "orange");
    reloadPersistedSettings();
    expect(useSettingsStore.getState().puckColor).toBe("orange");
    __resetSafeStorageForTests();
    reloadPersistedSettings();
  });
});
