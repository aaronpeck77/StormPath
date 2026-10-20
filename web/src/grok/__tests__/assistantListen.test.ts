import { describe, expect, it } from "vitest";
import { assistantListenNote, isMicDenied, isTransientMicFailure } from "../assistantListen";
import { assistantSendFromResponse } from "../grokDockClient";

describe("assistant listen notes", () => {
  it("calls a missed phrase a miss, not a missing mic", () => {
    expect(assistantListenNote("Stormy could not hear that.")).toBe("Didn't catch that.");
    expect(assistantListenNote("speech recognition unavailable")).toBe("Didn't catch that.");
    expect(isTransientMicFailure("microphone unavailable")).toBe(true);
    expect(isTransientMicFailure("Stormy could not hear that.")).toBe(false);
  });

  it("reserves No mic for a permission block", () => {
    expect(assistantListenNote("microphone denied")).toBe("No mic");
    expect(assistantListenNote("speech recognition denied")).toBe("No mic");
    expect(assistantListenNote("speech recognition restricted")).toBe("No mic");
    expect(isMicDenied("microphone unavailable")).toBe(false);
  });

  it("reads the spoken line from the assistant response", () => {
    expect(assistantSendFromResponse(true, { ok: true, say: "Hello there.", id: "abc" })).toEqual({
      ok: true,
      say: "Hello there.",
      id: "abc",
    });
    expect(assistantSendFromResponse(true, { ok: true })).toEqual({ ok: true, say: "", id: "" });
    expect(assistantSendFromResponse(false, { error: "Grok refused the key saved on stormpath2." })).toEqual({
      ok: false,
      error: "Grok refused the key saved on stormpath2.",
    });
    expect(assistantSendFromResponse(false, null).ok).toBe(false);
  });
});