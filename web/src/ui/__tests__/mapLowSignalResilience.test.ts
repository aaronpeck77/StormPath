import { describe, expect, it } from "vitest";
import {
  allowAutomaticFollowCamResync,
  allowBasemapStyleReload,
  allowFollowCamJumpToFallback,
  shouldClearHeldMapMatch,
  shouldHoldLastGoodMap,
} from "../mapLowSignalResilience";

describe("shouldHoldLastGoodMap", () => {
  it("holds immediately when the browser says offline", () => {
    expect(shouldHoldLastGoodMap({ navigatorOnLine: false, reachable: null })).toBe(true);
    expect(shouldHoldLastGoodMap({ navigatorOnLine: false, reachable: true })).toBe(true);
  });

  it("holds when a probe says the radio is a lie", () => {
    expect(shouldHoldLastGoodMap({ navigatorOnLine: true, reachable: false })).toBe(true);
  });

  it("does not hold on a healthy link", () => {
    expect(shouldHoldLastGoodMap({ navigatorOnLine: true, reachable: true })).toBe(false);
    expect(shouldHoldLastGoodMap({ navigatorOnLine: true, reachable: null })).toBe(false);
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
  it("skips automatic Jeff resync while holding last-good", () => {
    expect(allowAutomaticFollowCamResync(true)).toBe(false);
    expect(allowAutomaticFollowCamResync(false)).toBe(true);
  });

  it("allows jumpTo only for an intentional resync on a healthy link", () => {
    expect(
      allowFollowCamJumpToFallback({ intentionalResync: true, holdLastGoodMap: false })
    ).toBe(true);
    expect(
      allowFollowCamJumpToFallback({ intentionalResync: false, holdLastGoodMap: false })
    ).toBe(false);
    expect(
      allowFollowCamJumpToFallback({ intentionalResync: true, holdLastGoodMap: true })
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
