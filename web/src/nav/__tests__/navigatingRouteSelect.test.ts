import { describe, expect, it } from "vitest";
import {
  demotedRouteIdForPromote,
  resolveNavigatingRouteSelect,
} from "../navigatingRouteSelect";

describe("resolveNavigatingRouteSelect", () => {
  it("previews only while planning", () => {
    expect(
      resolveNavigatingRouteSelect({
        navigationStarted: false,
        selectedId: "r-b",
        lockedRouteId: "r-a",
        offRouteChoiceActive: true,
      })
    ).toEqual({ type: "preview" });
  });

  it("adopts a different leg on Rt even while still on the locked corridor", () => {
    expect(
      resolveNavigatingRouteSelect({
        navigationStarted: true,
        selectedId: "r-b",
        lockedRouteId: "r-a",
        offRouteChoiceActive: false,
      })
    ).toEqual({ type: "adopt", id: "r-b" });
  });

  it("adopts a different leg while off-route so Drive follows the Rt/Mp pick", () => {
    expect(
      resolveNavigatingRouteSelect({
        navigationStarted: true,
        selectedId: "r-b",
        lockedRouteId: "r-a",
        offRouteChoiceActive: true,
      })
    ).toEqual({ type: "adopt", id: "r-b" });
  });

  it("adopts when picking a different stub than the auto-rejoin guide", () => {
    expect(
      resolveNavigatingRouteSelect({
        navigationStarted: true,
        selectedId: "r-c",
        lockedRouteId: "r-a",
        temporaryGuidanceRouteId: "r-b",
      })
    ).toEqual({ type: "adopt", id: "r-c" });
  });

  it("returns to lock when driver picks the original corridor while on a rejoin stub", () => {
    expect(
      resolveNavigatingRouteSelect({
        navigationStarted: true,
        selectedId: "r-a",
        lockedRouteId: "r-a",
        temporaryGuidanceRouteId: "r-b",
      })
    ).toEqual({ type: "return_to_lock", lockedId: "r-a" });
  });

  it("previews when tapping the route Drive is already following", () => {
    expect(
      resolveNavigatingRouteSelect({
        navigationStarted: true,
        selectedId: "r-b",
        lockedRouteId: "r-a",
        temporaryGuidanceRouteId: "r-b",
      })
    ).toEqual({ type: "preview" });

    expect(
      resolveNavigatingRouteSelect({
        navigationStarted: true,
        selectedId: "r-a",
        lockedRouteId: "r-a",
        offRouteChoiceActive: true,
      })
    ).toEqual({ type: "preview" });
  });
});

describe("demotedRouteIdForPromote", () => {
  it("demotes the old lock when a different leg is promoted mid-trip", () => {
    expect(
      demotedRouteIdForPromote({
        navigationStarted: true,
        selectedId: "r-b",
        lockedRouteId: "r-a",
      })
    ).toBe("r-a");
  });

  it("demotes nothing before Go or when re-picking the lock", () => {
    expect(
      demotedRouteIdForPromote({
        navigationStarted: false,
        selectedId: "r-b",
        lockedRouteId: "r-a",
      })
    ).toBeNull();
    expect(
      demotedRouteIdForPromote({
        navigationStarted: true,
        selectedId: "r-a",
        lockedRouteId: "r-a",
      })
    ).toBeNull();
  });

  it("demotes nothing when there is no locked leg", () => {
    expect(
      demotedRouteIdForPromote({
        navigationStarted: true,
        selectedId: "r-b",
        lockedRouteId: null,
      })
    ).toBeNull();
  });
});
