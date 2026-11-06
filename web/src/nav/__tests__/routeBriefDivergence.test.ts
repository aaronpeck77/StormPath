import { describe, expect, it } from "vitest";
import { routeIsBriefDivergenceOnly } from "../routeGeometry";
import type { LngLat } from "../types";

/**
 * ~87.5 km per 0.01° lng at lat 38, ~111 km per 0.01° lat.
 * Main: due-east line at lat 38 from lng -90 to -88.8 (~105 km).
 */
function mainLine(): LngLat[] {
  const out: LngLat[] = [];
  for (let lng = -90; lng <= -88.8; lng += 0.01) out.push([lng, 38]);
  return out;
}

/** Main with a ~3.5 km north hop between lng -89.45 and -89.38 (exit/rejoin wobble). */
function woggleLine(): LngLat[] {
  const out: LngLat[] = [];
  for (let lng = -90; lng <= -89.46; lng += 0.01) out.push([lng, 38]);
  out.push([-89.45, 38.006], [-89.44, 38.012], [-89.43, 38.015]);
  for (let lng = -89.42; lng <= -89.4; lng += 0.005) out.push([lng, 38.015]);
  out.push([-89.39, 38.012], [-89.38, 38.006], [-89.37, 38]);
  for (let lng = -89.36; lng <= -88.8; lng += 0.01) out.push([lng, 38]);
  return out;
}

/** Main with a ~13 km sustained detour — a real alternate corridor. */
function realAlternateLine(): LngLat[] {
  const out: LngLat[] = [];
  for (let lng = -90; lng <= -89.5; lng += 0.01) out.push([lng, 38]);
  out.push([-89.49, 38.01], [-89.48, 38.04], [-89.47, 38.06]);
  for (let lng = -89.46; lng <= -89.31; lng += 0.01) out.push([lng, 38.06]);
  out.push([-89.3, 38.04], [-89.29, 38.01], [-89.28, 38]);
  for (let lng = -89.27; lng <= -88.8; lng += 0.01) out.push([lng, 38]);
  return out;
}

describe("routeIsBriefDivergenceOnly", () => {
  it("flags an exit/rejoin wobble as a non-alternate", () => {
    expect(routeIsBriefDivergenceOnly(mainLine(), woggleLine())).toBe(true);
  });

  it("keeps a sustained different corridor as a real alternate", () => {
    expect(routeIsBriefDivergenceOnly(mainLine(), realAlternateLine())).toBe(false);
  });

  it("does not flag the identical route (same-shape checks own that case)", () => {
    expect(routeIsBriefDivergenceOnly(mainLine(), mainLine())).toBe(false);
  });

  it("does not flag a route that stays within the corridor the whole way", () => {
    // ~550 m north of Main — inside the 800 m corridor, so never "diverged".
    const near: LngLat[] = mainLine().map(([lng]) => [lng, 38.005]);
    expect(routeIsBriefDivergenceOnly(mainLine(), near)).toBe(false);
  });

  it("ignores routes too short to judge", () => {
    const short: LngLat[] = [];
    for (let lng = -90; lng <= -89.96; lng += 0.005) short.push([lng, 38]);
    expect(routeIsBriefDivergenceOnly(short, short)).toBe(false);
  });
});
