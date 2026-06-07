import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: vi.fn(() => false) },
}));

import { Capacitor } from "@capacitor/core";
import { nwsApiRequestHeaders } from "../nwsClientHeaders";

describe("nwsApiRequestHeaders", () => {
  afterEach(() => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
  });

  it("omits User-Agent in browser dev (Vite proxy)", () => {
    expect(nwsApiRequestHeaders("StormPath/1.0 (+https://example.com/)")).toEqual({});
  });

  it("sends User-Agent on Capacitor native (TestFlight / App Store)", () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    const ua = "StormPath/1.0 (+https://example.com/ support@example.com)";
    expect(nwsApiRequestHeaders(ua)).toEqual({ "User-Agent": ua });
  });
});
