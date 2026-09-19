import { describe, expect, it } from "vitest";
import {
  CORE_NAV_STALE_MS,
  CORE_REROUTE_GRACE_MS,
  diyMayPlanReroute,
  resolveRerouteOwner,
  type CoreRerouteHealth,
} from "../rerouteOwner";

const NOW = 1_700_000_000_000;

function health(over: Partial<CoreRerouteHealth> = {}): CoreRerouteHealth {
  return {
    active: true,
    abandoned: false,
    lastProgressAtMs: NOW - 800,
    lastRouteChangedAtMs: null,
    ...over,
  };
}

describe("resolveRerouteOwner", () => {
  it("lets Core own the reroute while it is running", () => {
    const owner = resolveRerouteOwner({
      health: health(),
      offRouteSinceMs: null,
      nowMs: NOW,
    });
    expect(owner).toBe("core");
    expect(diyMayPlanReroute(owner)).toBe(false);
  });

  it("hands DIY the job on web-only Go (no native session)", () => {
    expect(
      resolveRerouteOwner({ health: null, offRouteSinceMs: null, nowMs: NOW })
    ).toBe("diy");
    expect(
      resolveRerouteOwner({
        health: health({ active: false }),
        offRouteSinceMs: null,
        nowMs: NOW,
      })
    ).toBe("diy");
  });

  it("hands DIY the job when Core abandoned this trip's corridor", () => {
    expect(
      resolveRerouteOwner({
        health: health({ abandoned: true }),
        offRouteSinceMs: null,
        nowMs: NOW,
      })
    ).toBe("diy");
  });

  it("hands DIY the job when Core has gone quiet", () => {
    expect(
      resolveRerouteOwner({
        health: health({ lastProgressAtMs: NOW - CORE_NAV_STALE_MS - 1 }),
        offRouteSinceMs: null,
        nowMs: NOW,
      })
    ).toBe("diy");
    expect(
      resolveRerouteOwner({
        health: health({ lastProgressAtMs: null }),
        offRouteSinceMs: null,
        nowMs: NOW,
      })
    ).toBe("diy");
  });

  it("keeps Core during its grace window after a confirmed off-route", () => {
    expect(
      resolveRerouteOwner({
        health: health(),
        offRouteSinceMs: NOW - 4_000,
        nowMs: NOW,
      })
    ).toBe("core");
  });

  it("takes over when Core never delivered a corridor for this episode", () => {
    expect(
      resolveRerouteOwner({
        health: health(),
        offRouteSinceMs: NOW - CORE_REROUTE_GRACE_MS - 1,
        nowMs: NOW,
      })
    ).toBe("diy");
  });

  it("stays with Core when its routeChanged answered this episode", () => {
    const since = NOW - CORE_REROUTE_GRACE_MS - 5_000;
    expect(
      resolveRerouteOwner({
        health: health({ lastRouteChangedAtMs: since + 2_000 }),
        offRouteSinceMs: since,
        nowMs: NOW,
      })
    ).toBe("core");
  });

  it("ignores a routeChanged from an earlier episode", () => {
    const since = NOW - CORE_REROUTE_GRACE_MS - 1_000;
    expect(
      resolveRerouteOwner({
        health: health({ lastRouteChangedAtMs: since - 30_000 }),
        offRouteSinceMs: since,
        nowMs: NOW,
      })
    ).toBe("diy");
  });
});
