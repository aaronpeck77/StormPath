import { beforeEach, describe, expect, it } from "vitest";
import {
  clearTripLog,
  listTripLog,
  recordTripLogEntry,
  tripLogRouteChain,
  tripLogToCsv,
  tripLogTotals,
  type TripLogEntry,
} from "../tripLog";
import { __resetSafeStorageForTests } from "../../storage/safeStorage";

function entry(over: Partial<Omit<TripLogEntry, "id">> = {}): Omit<TripLogEntry, "id"> {
  return {
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_600_000,
    originLabel: "Home",
    destinationLabel: "Office",
    distanceM: 10_000,
    ...over,
  };
}

describe("tripLog", () => {
  beforeEach(() => {
    __resetSafeStorageForTests();
    clearTripLog();
  });

  it("records newest-first and lists them back", () => {
    recordTripLogEntry(entry({ startedAt: 1000, destinationLabel: "First" }));
    recordTripLogEntry(entry({ startedAt: 2000, destinationLabel: "Second" }));
    const rows = listTripLog();
    expect(rows).toHaveLength(2);
    expect(rows[0]!.destinationLabel).toBe("Second");
    expect(rows[1]!.destinationLabel).toBe("First");
  });

  it("totals count and distance", () => {
    recordTripLogEntry(entry({ distanceM: 1609.344 }));
    recordTripLogEntry(entry({ distanceM: 3218.688 }));
    const t = tripLogTotals(listTripLog());
    expect(t.count).toBe(2);
    expect(t.distanceM).toBeCloseTo(4828.032, 3);
  });

  it("csv escapes commas and quotes, emits miles or km", () => {
    recordTripLogEntry(
      entry({ originLabel: 'Home, "Main" St', destinationLabel: "Office" })
    );
    const csv = tripLogToCsv(listTripLog(), true);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("Date,From,To,Stops,Miles,Minutes");
    expect(lines[1]).toContain('"Home, ""Main"" St"');
    expect(lines[1]).toContain("6.2"); // 10,000 m ≈ 6.2 mi
    expect(lines[1]).toContain("10"); // 600s = 10 min
    expect(lines[2]).toBe("Total,,,,6.2,10");
    const km = tripLogToCsv(listTripLog(), false);
    expect(km.split("\n")[0]).toBe("Date,From,To,Stops,Km,Minutes");
    expect(km.split("\n")[1]).toContain("10.0");
  });

  it("csv lists via stops and the chain helper joins origin→stops→dest", () => {
    recordTripLogEntry(
      entry({
        originLabel: "Yard",
        destinationLabel: "Customer",
        stops: ["Scale House", "Dock 4"],
      })
    );
    const lines = tripLogToCsv(listTripLog(), true).trim().split("\n");
    expect(lines[1]).toContain("Scale House → Dock 4");
    expect(tripLogRouteChain(listTripLog()[0]!)).toBe(
      "Yard → Scale House → Dock 4 → Customer"
    );
  });

  it("clearTripLog empties the log", () => {
    recordTripLogEntry(entry());
    clearTripLog();
    expect(listTripLog()).toHaveLength(0);
  });
});
