import { describe, expect, it } from "vitest";
import {
  dockCodeOk,
  handleDockRpc,
  handlePhoneClaim,
  planRoute,
  speakablePlan,
  trafficNoteFromDurations,
  weatherNoteFromEvents,
  type DockSession,
  type DockStore,
  type DockTripService,
} from "../grokDock";

function memoryStore(): DockStore & { sessions: Map<string, DockSession> } {
  const sessions = new Map<string, DockSession>();
  return {
    sessions,
    async get(code) {
      return sessions.get(code) ?? null;
    },
    async put(session) {
      sessions.set(session.code, session);
    },
  };
}

const trip: DockTripService = {
  async geocode(query) {
    if (query.toLowerCase().includes("nowhere")) return null;
    return { label: query, lng: -81.3, lat: 28.4 };
  },
  async measure() {
    return {
      minutes: 450,
      miles: 430,
      trafficNote: "Traffic adds about 20 minutes.",
      weatherNote: "Weather warnings: Severe Thunderstorm Warning.",
    };
  },
};

describe("grok dock facts", () => {
  it("accepts a six-character code and refuses a short one", () => {
    expect(dockCodeOk("K7MQ2P")).toBe(true);
    expect(dockCodeOk("hi")).toBe(false);
  });

  it("states the extra traffic minutes and the warnings StormPath found", () => {
    expect(trafficNoteFromDurations(40, 20, 0)).toBe("Traffic adds about 20 minutes.");
    expect(weatherNoteFromEvents(["Hail Warning", "Hail Warning"])).toBe("Weather warnings: Hail Warning.");
    expect(weatherNoteFromEvents([])).toBe("No weather warnings at the points StormPath checked.");
  });

  it("tells Grok to say only the measured trip and to wait for Go", async () => {
    const store = memoryStore();
    await handlePhoneClaim(store, "K7MQ2P");
    const session = (await store.get("K7MQ2P"))!;
    session.origin = { lng: -84.3, lat: 33.7, at: "2026-10-18T00:00:00Z" };
    const plan = await planRoute(store, trip, session, "Disney World", "Nashville");
    expect(plan.summary).toContain("7 hours 30 minutes");
    expect(plan.summary).toContain("hit Go");
    expect(plan.summary).toContain("Do not add a storm");
    expect(speakablePlan(plan)).toContain("Nashville");
  });

  it("lists tools and refuses a code the phone never claimed", async () => {
    const store = memoryStore();
    const listed = await handleDockRpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, store, trip);
    expect(listed?.body).toContain("plan_route");
    const missed = await handleDockRpc(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "plan_route", arguments: { dock_code: "ZZZZZZ", destination: "Orlando" } },
      },
      store,
      trip
    );
    expect(missed?.body).toContain("not connected");
  });
});
