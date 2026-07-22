import { describe, expect, it } from "vitest";
import {
  STAY_ON_BANNER_MIN_M,
  formatStayOnRoadLabel,
  resolveStayOnBannerCopy,
  roadLabelFromContinueInstruction,
} from "../bannerStayOnCopy";

describe("formatStayOnRoadLabel", () => {
  it("prefers ref, combines when both differ", () => {
    expect(formatStayOnRoadLabel({ roadRef: "I 72", roadName: "I-72" })).toBe("I 72");
    expect(formatStayOnRoadLabel({ roadRef: "I-72", roadName: "I 72" })).toBe("I-72");
    expect(formatStayOnRoadLabel({ roadRef: "I 72", roadName: "Eastbound" })).toBe(
      "I 72 / Eastbound"
    );
    expect(formatStayOnRoadLabel({ roadName: "Main Street" })).toBe("Main Street");
  });
});

describe("roadLabelFromContinueInstruction", () => {
  it("pulls road from continue / head lines", () => {
    expect(roadLabelFromContinueInstruction("Continue on I-72 for 12 miles")).toBe("I-72");
    expect(roadLabelFromContinueInstruction("Stay on Main Street")).toBe("Main Street");
    expect(roadLabelFromContinueInstruction("Head north on US 36")).toBe("US 36");
    expect(roadLabelFromContinueInstruction("Turn left onto Oak")).toBeNull();
  });
});

describe("resolveStayOnBannerCopy", () => {
  it("uses stay-on when far and road known", () => {
    const copy = resolveStayOnBannerCopy({
      remainM: STAY_ON_BANNER_MIN_M + 100,
      turnInstruction: "Turn left onto Oak St",
      roadLabel: "I-72",
      alongLabel: "5.2 mi",
      distFallback: "",
    });
    expect(copy.stayOnMode).toBe(true);
    expect(copy.headline).toBe("Stay on I-72");
    expect(copy.distLine).toBe("for 5.2 mi");
  });

  it("flips to turn countdown within a couple miles", () => {
    const copy = resolveStayOnBannerCopy({
      remainM: STAY_ON_BANNER_MIN_M - 1,
      turnInstruction: "Turn left onto Oak St",
      roadLabel: "I-72",
      alongLabel: "1.8 mi",
      distFallback: "",
    });
    expect(copy.stayOnMode).toBe(false);
    expect(copy.headline).toBe("Turn left onto Oak St");
    expect(copy.distLine).toBe("1.8 mi ahead");
  });

  it("keeps turn text when road unknown even if far", () => {
    const copy = resolveStayOnBannerCopy({
      remainM: 20_000,
      turnInstruction: "Continue",
      roadLabel: null,
      alongLabel: "12 mi",
      distFallback: "",
    });
    expect(copy.stayOnMode).toBe(false);
    expect(copy.distLine).toBe("12 mi ahead");
  });
});
