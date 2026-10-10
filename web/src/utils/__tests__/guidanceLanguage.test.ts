import { describe, expect, it } from "vitest";
import { resolveGuidanceLanguage, weatherKitLanguageTag } from "../guidanceLanguage";

describe("guidanceLanguage", () => {
  it("follows an Italian phone", () => {
    expect(resolveGuidanceLanguage("system", "it-IT")).toBe("it");
    expect(weatherKitLanguageTag("it")).toBe("it");
  });

  it("forces English from About even when the phone is Italian", () => {
    expect(resolveGuidanceLanguage("en", "it-IT")).toBe("en");
    expect(weatherKitLanguageTag("en")).toBe("en-US");
  });

  it("stays English for a language Mapbox does not speak", () => {
    expect(resolveGuidanceLanguage("system", "xx-ZZ")).toBe("en");
  });
});
