import { describe, expect, it } from "vitest";
import { FetchTimeoutError, isNoConnectionError } from "../fetchResilient";

describe("isNoConnectionError", () => {
  it("returns false for abort errors even when offline", () => {
    const abort = new DOMException("Aborted", "AbortError");
    expect(isNoConnectionError(abort, false)).toBe(false);
    expect(isNoConnectionError(abort, true)).toBe(false);
  });

  it("returns true for a TypeError (DNS / dropped connection)", () => {
    expect(isNoConnectionError(new TypeError("fetch failed"), true)).toBe(true);
  });

  it("returns true for a timeout error", () => {
    expect(isNoConnectionError(new FetchTimeoutError(), true)).toBe(true);
  });

  it("returns true for a generic error while offline", () => {
    expect(isNoConnectionError(new Error("whatever"), false)).toBe(true);
  });

  it("returns false for a generic error while online", () => {
    expect(isNoConnectionError(new Error("HTTP 500"), true)).toBe(false);
  });
});
