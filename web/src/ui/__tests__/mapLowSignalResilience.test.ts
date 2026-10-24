import { describe, expect, it } from "vitest";
import {
  allowAutomaticFollowCamResync,
  allowBasemapStyleReload,
  allowFollowCamJumpToFallback,
  nextLowDataAdvisory,
  shouldApplyMapHoldOnNativeRadioDown,
  shouldClearHeldMapMatch,
  shouldClearLastGoodMapHold,
  shouldHoldLastGoodMap,
} from "../mapLowSignalResilience";

describe("shouldApplyMapHoldOnNativeRadioDown", () => {
  it("holds the map during GO as soon as native radio is down", () => {
    expect(
      shouldApplyMapHoldOnNativeRadioDown({
        nativeConnected: false,
        navigationStarted: true,
        alreadyHolding: false,
      })
    ).toBe(true);
  });

  it("does not hold while planning just because native is down", () => {
    expect(
      shouldApplyMapHoldOnNativeRadioDown({
        nativeConnected: false,
        navigationStarted: false,
        alreadyHolding: false,
      })
    ).toBe(false);
  });

  it("keeps an existing hold if native is still down", () => {
    expect(
      shouldApplyMapHoldOnNativeRadioDown({
        nativeConnected: false,
        navigationStarted: false,
        alreadyHolding: true,
      })
    ).toBe(true);
  });
});

describe("shouldHoldLastGoodMap", () => {
  it("holds immediately when the browser says offline", () => {
    expect(shouldHoldLastGoodMap({ navigatorOnLine: false, reachable: null })).toBe(true);
    expect(shouldHoldLastGoodMap({ navigatorOnLine: false, reachable: true })).toBe(true);
  });

  it("does not hold when native radio is up even if navigator.onLine is stuck false", () => {
    expect(
      shouldHoldLastGoodMap({
        navigatorOnLine: false,
        nativeConnected: true,
        reachable: null,
      })
    ).toBe(false);
  });

  it("holds when the native radio is down even if the browser still says online", () => {
    expect(
      shouldHoldLastGoodMap({
        navigatorOnLine: true,
        nativeConnected: false,
        reachable: true,
      })
    ).toBe(true);
  });

  it("holds when a probe says the radio is a lie", () => {
    expect(shouldHoldLastGoodMap({ navigatorOnLine: true, reachable: false })).toBe(true);
  });

  it("does not hold on a healthy link", () => {
    expect(shouldHoldLastGoodMap({ navigatorOnLine: true, reachable: true })).toBe(false);
    expect(shouldHoldLastGoodMap({ navigatorOnLine: true, reachable: null })).toBe(false);
  });
});

describe("nextLowDataAdvisory", () => {
  const base = {
    showing: false,
    offline: false,
    nativeDown: false,
    probeFresh: true,
    probeOk: false as boolean | null,
    consecutiveProbeFails: 0,
  };

  it("says so immediately when the radio is down", () => {
    expect(nextLowDataAdvisory({ ...base, nativeDown: true }).showing).toBe(true);
    expect(nextLowDataAdvisory({ ...base, offline: true }).showing).toBe(true);
  });

  it("waits for a second miss while the phone still says it is connected", () => {
    const first = nextLowDataAdvisory(base);
    expect(first.showing).toBe(false);
    expect(first.consecutiveProbeFails).toBe(1);
    const second = nextLowDataAdvisory({ ...base, consecutiveProbeFails: first.consecutiveProbeFails });
    expect(second.showing).toBe(true);
  });

  it("drops the sentence on the first fresh success and ignores a stale miss", () => {
    const cleared = nextLowDataAdvisory({
      ...base,
      showing: true,
      probeOk: true,
      consecutiveProbeFails: 2,
    });
    expect(cleared).toEqual({ showing: false, consecutiveProbeFails: 0 });
    const stale = nextLowDataAdvisory({
      ...base,
      showing: false,
      probeFresh: false,
      probeOk: false,
      consecutiveProbeFails: 0,
    });
    expect(stale).toEqual({ showing: false, consecutiveProbeFails: 0 });
  });
});

describe("shouldClearLastGoodMapHold", () => {
  it("waits out brief flaps before clearing the hold", () => {
    const first = shouldClearLastGoodMapHold({
      holdActive: true,
      linkHealthy: true,
      healthySinceMs: null,
      nowMs: 1_000,
      hysteresisMs: 4_000,
    });
    expect(first.clear).toBe(false);
    expect(first.healthySinceMs).toBe(1_000);

    const tooSoon = shouldClearLastGoodMapHold({
      holdActive: true,
      linkHealthy: true,
      healthySinceMs: 1_000,
      nowMs: 3_000,
      hysteresisMs: 4_000,
    });
    expect(tooSoon.clear).toBe(false);

    const ready = shouldClearLastGoodMapHold({
      holdActive: true,
      linkHealthy: true,
      healthySinceMs: 1_000,
      nowMs: 5_500,
      hysteresisMs: 4_000,
    });
    expect(ready.clear).toBe(true);
  });

  it("resets the healthy timer when the link drops again", () => {
    const drop = shouldClearLastGoodMapHold({
      holdActive: true,
      linkHealthy: false,
      healthySinceMs: 1_000,
      nowMs: 2_000,
    });
    expect(drop.clear).toBe(false);
    expect(drop.healthySinceMs).toBeNull();
  });
});

describe("allowBasemapStyleReload", () => {
  it("blocks day/night setStyle during GO or a dead-zone hold", () => {
    expect(allowBasemapStyleReload({ navigationStarted: true, holdLastGoodMap: false })).toBe(
      false
    );
    expect(allowBasemapStyleReload({ navigationStarted: false, holdLastGoodMap: true })).toBe(
      false
    );
  });

  it("allows a style swap only while planning and reachable", () => {
    expect(allowBasemapStyleReload({ navigationStarted: false, holdLastGoodMap: false })).toBe(
      true
    );
  });
});

describe("follow-cam repairs", () => {
  it("always allows automatic GPS follow resync (hold is tiles/traffic only)", () => {
    expect(allowAutomaticFollowCamResync(true)).toBe(true);
    expect(allowAutomaticFollowCamResync(false)).toBe(true);
  });

  it("allows jumpTo when GPS follow is stalled even under hold", () => {
    expect(
      allowFollowCamJumpToFallback({
        intentionalResync: false,
        holdLastGoodMap: true,
        gpsFollowStalled: true,
      })
    ).toBe(true);
    expect(
      allowFollowCamJumpToFallback({ intentionalResync: true, holdLastGoodMap: true })
    ).toBe(true);
    expect(
      allowFollowCamJumpToFallback({ intentionalResync: false, holdLastGoodMap: false })
    ).toBe(false);
  });
});

describe("shouldClearHeldMapMatch", () => {
  it("keeps the last snap while GO is on even if the cell drops", () => {
    expect(
      shouldClearHeldMapMatch({ navigationStarted: true, enabled: true, disabled: false })
    ).toBe(false);
  });

  it("clears when the trip ends or matching is off", () => {
    expect(shouldClearHeldMapMatch({ navigationStarted: false, enabled: true })).toBe(true);
    expect(shouldClearHeldMapMatch({ navigationStarted: true, enabled: false })).toBe(true);
    expect(shouldClearHeldMapMatch({ navigationStarted: true, enabled: true, disabled: true })).toBe(
      true
    );
  });
});
