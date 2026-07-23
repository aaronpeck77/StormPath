import { describe, expect, it, vi } from "vitest";
import { noteForJeffDomain, reportJeffSighting, subscribeJeffSightings } from "../jeffTheBot";

describe("jeffTheBot", () => {
  it("notifies subscribers with the domain and note when a sighting is reported", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeJeffSightings(listener);

    reportJeffSighting("drive_camera", noteForJeffDomain("drive_camera"));

    expect(listener).toHaveBeenCalledTimes(1);
    const sighting = listener.mock.calls[0][0];
    expect(sighting.domain).toBe("drive_camera");
    expect(sighting.note).toBe(noteForJeffDomain("drive_camera"));
    expect(typeof sighting.atMs).toBe("number");

    unsubscribe();
  });

  it("stops notifying after unsubscribing", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeJeffSightings(listener);
    unsubscribe();

    reportJeffSighting("live_traffic", noteForJeffDomain("live_traffic"));

    expect(listener).not.toHaveBeenCalled();
  });

  it("supports multiple independent subscribers", () => {
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = subscribeJeffSightings(a);
    const unsubB = subscribeJeffSightings(b);

    reportJeffSighting("live_traffic", "test note");

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    unsubA();
    unsubB();
  });
});
