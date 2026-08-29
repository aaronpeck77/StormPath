import { describe, expect, it } from "vitest";
import { readHomePuckFollow } from "../homePuckFollow";

describe("readHomePuckFollow", () => {
  it("defaults to explore so launch allows free pan and zoom", () => {
    expect(readHomePuckFollow()).toBe("explore");
  });
});
