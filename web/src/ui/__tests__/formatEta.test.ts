import { describe, expect, it } from "vitest";
import { formatArrivalClockCompact } from "../formatEta";

const SEATTLE: [number, number] = [-122.33, 47.61];
const CHICAGO: [number, number] = [-87.63, 41.88];

describe("formatArrivalClockCompact", () => {
  it("stays a same-day compact clock without dest coords", () => {
    const atMs = Date.parse("2026-10-14T22:14:00-05:00");
    expect(formatArrivalClockCompact(atMs, { nowMs: atMs })).toMatch(/^\d{1,2}:\d{2}[ap]$/);
  });

  it("prints dest-local weekday when arrival is a different calendar day", () => {
    const nowMs = Date.parse("2026-10-15T02:32:00Z");
    const atMs = Date.parse("2026-10-16T12:32:00Z");
    const label = formatArrivalClockCompact(atMs, { destLngLat: SEATTLE, nowMs });
    expect(label).toMatch(/Fri/i);
    expect(label).toMatch(/5:32a/);
    expect(label).toMatch(/PDT|PST/);
  });

  it("does not add a weekday for a same-day arrival in dest time", () => {
    const nowMs = Date.parse("2026-10-14T18:00:00Z");
    const atMs = Date.parse("2026-10-14T20:00:00Z");
    const label = formatArrivalClockCompact(atMs, { destLngLat: CHICAGO, nowMs });
    expect(label).not.toMatch(/Mon|Tue|Wed|Thu|Fri|Sat|Sun/);
    expect(label).toMatch(/^\d{1,2}:\d{2}[ap]/);
  });
});
