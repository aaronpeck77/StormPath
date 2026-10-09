import { describe, expect, it } from "vitest";
import { FALLBACK_LNGLAT } from "../../nav/constants";
import { safeStorage } from "../../storage/safeStorage";
import { neighborhoodBounds, readLastMapOpen, writeLastMapOpen } from "../lastMapOpen";

describe("lastMapOpen", () => {
  it("remembers a street-level frame and ignores the country default", () => {
    safeStorage.remove("stormpath-last-map-open");
    writeLastMapOpen({ lng: -88.95, lat: 39.84, zoom: 14.2, bearing: 12 });
    const saved = readLastMapOpen();
    expect(saved?.lng).toBeCloseTo(-88.95);
    expect(saved?.lat).toBeCloseTo(39.84);
    expect(saved?.zoom).toBeCloseTo(14.2);
    writeLastMapOpen({ lng: FALLBACK_LNGLAT[0], lat: FALLBACK_LNGLAT[1], zoom: 14 });
    expect(readLastMapOpen()?.lng).toBeCloseTo(-88.95);
    writeLastMapOpen({ lng: -88.95, lat: 39.84, zoom: 4 });
    expect(readLastMapOpen()?.zoom).toBeCloseTo(14.2);
  });

  it("builds a box around the neighborhood", () => {
    const [[w, s], [e, n]] = neighborhoodBounds(-88.9, 39.8);
    expect(e).toBeGreaterThan(w);
    expect(n).toBeGreaterThan(s);
  });
});
