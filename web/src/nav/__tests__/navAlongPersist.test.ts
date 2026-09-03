import { afterEach, describe, expect, it } from "vitest";
import {
  clearPersistedNavAlong,
  navAlongGeomSig,
  readPersistedNavAlong,
  resetNavAlongPersistThrottleForTests,
  writePersistedNavAlong,
} from "../navAlongPersist";
import type { LngLat } from "../types";

describe("navAlongPersist", () => {
  afterEach(() => {
    clearPersistedNavAlong();
    resetNavAlongPersistThrottleForTests();
  });

  it("round-trips along for the same geometry after a refresh", () => {
    const geom: LngLat[] = [
      [-86.78, 36.16],
      [-86.79, 36.17],
      [-86.8, 36.18],
    ];
    const sig = navAlongGeomSig(geom);
    writePersistedNavAlong(sig, 12_400);
    expect(readPersistedNavAlong(sig)).toBe(12_400);
    expect(readPersistedNavAlong("other")).toBeNull();
  });
});
