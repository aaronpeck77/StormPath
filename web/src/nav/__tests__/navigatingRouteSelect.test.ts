import { describe, expect, it } from "vitest";
import { resolveNavigatingRouteSelect } from "../navigatingRouteSelect";

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

  it("previews on-route compare without adopting (Drive stays on lock)", () => {
    expect(
      resolveNavigatingRouteSelect({
        navigationStarted: true,
        selectedId: "r-b",
        lockedRouteId: "r-a",
        offRouteChoiceActive: false,
      })
    ).toEqual({ type: "preview" });
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
