import { describe, expect, it } from "vitest";
import { readHomePuckFollow } from "../homePuckFollow";

describe("readHomePuckFollow", () => {
  it("defaults to follow so launch centers the puck on GPS", () => {
    expect(readHomePuckFollow()).toBe("follow");
  });
});
