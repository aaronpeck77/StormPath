import { describe, expect, it } from "vitest";
import { readHomePuckFollow } from "../homePuckFollow";

describe("readHomePuckFollow", () => {
  it("defaults to explore so the home map does not auto-recenter on GPS", () => {
    expect(readHomePuckFollow()).toBe("explore");
  });
});
