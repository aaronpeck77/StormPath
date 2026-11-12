import { describe, expect, it } from "vitest";
import {
  LEARNED_ROUTE_ID_PREFIX,
  learnedMatchToNavRoute,
  learnedStartTimesMatch,
  matchLearnedPlanRoute,
} from "../planRouteOffer";
import type { FrequentRouteCluster } from "../types";
import type { LngLat } from "../../nav/types";

const HOME: LngLat = [-88.95, 39.85];
const WORK: LngLat = [-88.2, 39.75];
const MID: LngLat = [-88.58, 39.81];

function cluster(over: Partial<FrequentRouteCluster> = {}): FrequentRouteCluster {
  return {
    id: "fr-1",
    count: 5,
    lastSeen: Date.now(),
    geometry: [HOME, MID, WORK],
    centerStart: HOME,
    centerEnd: WORK,
    recentStarts: [Date.now() - 86_400_000, Date.now() - 7 * 86_400_000, Date.now() - 14 * 86_400_000],
    ...over,
  };
}

/** A timestamp `daysBack` days ago at the same wall-clock time as `now`. */
function sameTimeDaysAgo(now: number, daysBack: number): number {
  const d = new Date(now);
  d.setDate(d.getDate() - daysBack);
  return d.getTime();
}

describe("matchLearnedPlanRoute", () => {
  it("offers a learned corridor when origin, dest, count, and recency match", () => {
    const now = new Date(2026, 10, 12, 7, 10).getTime();
    const c = cluster({
      recentStarts: [sameTimeDaysAgo(now, 1), sameTimeDaysAgo(now, 8), sameTimeDaysAgo(now, 15)],
      lastSeen: now - 86_400_000,
    });
    const m = matchLearnedPlanRoute({
      clusters: [c],
      userLngLat: HOME,
      destLngLat: WORK,
      now,
    });
    expect(m).not.toBeNull();
    expect(m!.geometry.length).toBeGreaterThanOrEqual(2);
  });

  it("rejects clusters below the repeat threshold", () => {
    const now = Date.now();
    const c = cluster({ count: 2 });
    expect(
      matchLearnedPlanRoute({ clusters: [c], userLngLat: HOME, destLngLat: WORK, now })
    ).toBeNull();
  });

  it("rejects stale clusters", () => {
    const now = Date.now();
    const c = cluster({ lastSeen: now - 60 * 24 * 60 * 60 * 1000 });
    expect(
      matchLearnedPlanRoute({ clusters: [c], userLngLat: HOME, destLngLat: WORK, now })
    ).toBeNull();
  });

  it("rejects when the driver is far from the learned start", () => {
    const now = Date.now();
    const c = cluster();
    const far: LngLat = [-87.6, 41.8];
    expect(
      matchLearnedPlanRoute({ clusters: [c], userLngLat: far, destLngLat: WORK, now })
    ).toBeNull();
  });

  it("rejects when the destination is far from the learned end", () => {
    const now = Date.now();
    const c = cluster();
    const elsewhere: LngLat = [-90.5, 38.9];
    expect(
      matchLearnedPlanRoute({ clusters: [c], userLngLat: HOME, destLngLat: elsewhere, now })
    ).toBeNull();
  });

  it("orients reversed cluster geometry toward the planned trip", () => {
    const now = new Date(2026, 10, 12, 7, 10).getTime();
    const reversed = cluster({
      geometry: [WORK, MID, HOME],
      centerStart: WORK,
      centerEnd: HOME,
      recentStarts: [sameTimeDaysAgo(now, 1), sameTimeDaysAgo(now, 8), sameTimeDaysAgo(now, 15)],
      lastSeen: now - 86_400_000,
    });
    const m = matchLearnedPlanRoute({
      clusters: [reversed],
      userLngLat: HOME,
      destLngLat: WORK,
      now,
    });
    expect(m).not.toBeNull();
    const first = m!.geometry[0]!;
    const last = m!.geometry[m!.geometry.length - 1]!;
    /* Trimmed geometry still runs home → work. */
    expect(first[0]).toBeLessThan(-88.9);
    expect(last[0]).toBeGreaterThan(-88.3);
  });

  it("suppresses the card when the learned path is effectively Main", () => {
    const now = Date.now();
    /* Learned trace hugging the same corridor as the primary route. */
    const samePath = cluster({
      geometry: [
        [-88.951, 39.851],
        [-88.7, 39.83],
        [-88.4, 39.8],
        [-88.2, 39.751],
      ],
    });
    const primary: LngLat[] = [
      [-88.95, 39.85],
      [-88.7, 39.83],
      [-88.4, 39.8],
      [-88.2, 39.75],
    ];
    expect(
      matchLearnedPlanRoute({
        clusters: [samePath],
        userLngLat: HOME,
        destLngLat: WORK,
        primaryGeometry: primary,
        now,
      })
    ).toBeNull();
  });

  it("still offers when no primary geometry is available to compare", () => {
    const now = Date.now();
    const c = cluster();
    expect(
      matchLearnedPlanRoute({ clusters: [c], userLngLat: HOME, destLngLat: WORK, now })
    ).not.toBeNull();
  });
});

describe("learnedStartTimesMatch", () => {
  it("passes with thin history", () => {
    expect(learnedStartTimesMatch(undefined, Date.now())).toBe(true);
    expect(learnedStartTimesMatch([Date.now()], Date.now())).toBe(true);
  });

  it("passes inside the usual-time window and fails outside it", () => {
    const now = new Date(2026, 10, 12, 7, 10).getTime();
    const morning = [
      sameTimeDaysAgo(now, 1),
      sameTimeDaysAgo(now, 8),
      sameTimeDaysAgo(now, 15),
    ];
    expect(learnedStartTimesMatch(morning, now)).toBe(true);
    const eveningNow = new Date(2026, 10, 12, 19, 30).getTime();
    /* Same dates but 'now' is evening — outside the ±80 min window of 7am starts. */
    expect(learnedStartTimesMatch(morning, eveningNow)).toBe(false);
  });

  it("gates the weekday when history shows a real weekly rhythm", () => {
    const now = new Date(2026, 10, 12, 7, 10).getTime();
    const nowDow = new Date(now).getDay();
    /* Three starts on three distinct weekdays, none equal to today's. */
    const otherDows = [1, 3, 5].filter((d) => d !== nowDow).concat([0, 2, 4, 6].filter((d) => d !== nowDow)).slice(0, 3);
    const starts = otherDows.map((dow, i) => {
      const d = new Date(now);
      d.setDate(d.getDate() - 7 * (i + 1));
      while (d.getDay() !== dow) d.setDate(d.getDate() - 1);
      d.setHours(7, 5, 0, 0);
      return d.getTime();
    });
    expect(new Set(starts.map((t) => new Date(t).getDay())).size).toBe(3);
    expect(learnedStartTimesMatch(starts, now)).toBe(false);
    /* Same clock time on today's weekday passes. */
    const today = new Date(now);
    today.setHours(7, 5, 0, 0);
    const mixed = [...starts.slice(0, 2), today.getTime()];
    /* 3 unique days incl. today → gate passes the day check; time matches too. */
    expect(learnedStartTimesMatch(mixed, now)).toBe(true);
  });
});

describe("learnedMatchToNavRoute", () => {
  it("builds a navigable route with the your-route id prefix", () => {
    const m = matchLearnedPlanRoute({
      clusters: [cluster()],
      userLngLat: HOME,
      destLngLat: WORK,
      now: Date.now(),
    });
    expect(m).not.toBeNull();
    const route = learnedMatchToNavRoute(m!);
    expect(route.id.startsWith(LEARNED_ROUTE_ID_PREFIX)).toBe(true);
    expect(route.id.startsWith("r-your-route")).toBe(true);
    expect(route.label).toBe("Your route");
    expect(route.baseEtaMinutes).toBeGreaterThan(0);
    expect(route.turnSteps?.length).toBeGreaterThan(0);
    expect(route.geometry.length).toBeGreaterThanOrEqual(2);
  });
});
