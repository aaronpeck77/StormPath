import { describe, expect, it } from "vitest";
import {
  NETWORK_HANDOFF_GRACE_MS,
  nextOnlineState,
  resolveRadioUp,
} from "../networkConnectivity";

describe("resolveRadioUp", () => {
  it("trusts the native radio over a stuck WKWebView navigator.onLine", () => {
    expect(resolveRadioUp({ navigatorOnLine: false, nativeConnected: true })).toBe(true);
    expect(resolveRadioUp({ navigatorOnLine: true, nativeConnected: false })).toBe(false);
  });

  it("falls back to the browser flag when native status is unknown", () => {
    expect(resolveRadioUp({ navigatorOnLine: true, nativeConnected: null })).toBe(true);
    expect(resolveRadioUp({ navigatorOnLine: false, nativeConnected: null })).toBe(false);
  });
});

describe("nextOnlineState", () => {
  it("clears a drop the moment the radio is up", () => {
    expect(
      nextOnlineState({ radioUp: true, downSinceMs: 1_000, nowMs: 1_400 })
    ).toEqual({ isOnline: true, downSinceMs: null });
  });

  it("stays online during a short Wi‑Fi → cell gap", () => {
    const start = 10_000;
    const mid = nextOnlineState({
      radioUp: false,
      downSinceMs: null,
      nowMs: start,
    });
    expect(mid.isOnline).toBe(true);
    expect(mid.downSinceMs).toBe(start);
    expect(
      nextOnlineState({
        radioUp: false,
        downSinceMs: mid.downSinceMs,
        nowMs: start + NETWORK_HANDOFF_GRACE_MS - 1,
      }).isOnline
    ).toBe(true);
  });

  it("goes offline after the grace if the radio stays down", () => {
    const start = 10_000;
    expect(
      nextOnlineState({
        radioUp: false,
        downSinceMs: start,
        nowMs: start + NETWORK_HANDOFF_GRACE_MS,
      }).isOnline
    ).toBe(false);
  });
});
