import { describe, expect, it, vi } from "vitest";
import { stopGuidanceThenClearTrip } from "../tripStop";

describe("stopGuidanceThenClearTrip", () => {
  it("clears the trip after native guidance has stopped", async () => {
    const order: string[] = [];
    const stop = vi.fn(async () => {
      order.push("stop");
    });
    const clear = vi.fn(() => {
      order.push("clear");
    });
    await stopGuidanceThenClearTrip(stop, clear);
    expect(order).toEqual(["stop", "clear"]);
  });

  it("still clears if native stop throws", async () => {
    const clear = vi.fn();
    await stopGuidanceThenClearTrip(async () => {
      throw new Error("plugin down");
    }, clear);
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("clears immediately on web when there is no native session", async () => {
    const clear = vi.fn();
    await stopGuidanceThenClearTrip(undefined, clear);
    expect(clear).toHaveBeenCalledTimes(1);
  });
});
