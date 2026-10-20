import { describe, expect, it } from "vitest";
import {
  assistantOkBody,
  dockCodeOk,
  handleDockRpc,
  handlePhoneClaim,
  LOCATION_NEEDED,
  planRoute,
  prepareAssistantForward,
  messagesToSpeak,
  rememberDriverMessage,
  saveAssistantReply,
  speakablePlan,
  takeRateSlot,
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

  it("asks for the phone location instead of a vague road error", async () => {
    const store = memoryStore();
    await handlePhoneClaim(store, "K7MQ2P");
    const session = (await store.get("K7MQ2P"))!;
    await expect(planRoute(store, trip, session, "Disney World", null)).rejects.toThrow(LOCATION_NEEDED);
  });

  it("keeps the last 20 replies and slows a noisy code", async () => {
    const store = memoryStore();
    await handlePhoneClaim(store, "K7MQ2P");
    const session = (await store.get("K7MQ2P"))!;
    for (let i = 0; i < 25; i++) rememberDriverMessage(session, `line ${i}`);
    expect(session.messages).toHaveLength(20);
    expect(session.messages?.[0]?.text).toBe("line 5");
    const now = Date.now();
    for (let i = 0; i < 20; i++) expect(takeRateSlot(session, now)).toBe(true);
    expect(takeRateSlot(session, now)).toBe(false);
    const sent = await prepareAssistantForward(store, { dock_code: "K7MQ2P", text: "Plan Disney" });
    expect(sent.ok).toBe(false);
    if (!sent.ok) expect(sent.error).toContain("Wait a minute");
  });

  it("stores a short reply for the phone to speak", async () => {
    const store = memoryStore();
    await handlePhoneClaim(store, "K7MQ2P");
    const said = await handleDockRpc(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "say_to_driver", arguments: { dock_code: "K7MQ2P", message: "Hit Go when you are ready." } },
      },
      store,
      trip
    );
    expect(said?.body).toContain("Hit Go when you are ready.");
    expect((await store.get("K7MQ2P"))?.messages?.[0]?.text).toBe("Hit Go when you are ready.");
  });

  it("queues a start only after a destination, and a stop when asked", async () => {
    const store = memoryStore();
    await handlePhoneClaim(store, "K7MQ2P");
    const early = await handleDockRpc(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "start_drive", arguments: { dock_code: "K7MQ2P" } },
      },
      store,
      trip
    );
    expect(early?.body).toContain("Set a destination");
    const session = (await store.get("K7MQ2P"))!;
    session.origin = { lng: -84.3, lat: 33.7, at: "2026-10-18T00:00:00Z" };
    await planRoute(store, trip, session, "Orlando", null);
    const started = await handleDockRpc(
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "start_drive", arguments: { dock_code: "K7MQ2P" } },
      },
      store,
      trip
    );
    expect(started?.body).toContain("start the drive");
    expect((await store.get("K7MQ2P"))?.control?.action).toBe("start");
    const stopped = await handleDockRpc(
      {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: { name: "stop_drive", arguments: { dock_code: "K7MQ2P" } },
      },
      store,
      trip
    );
    expect(stopped?.body).toContain("stop the route");
    expect((await store.get("K7MQ2P"))?.control?.action).toBe("stop");
  });

  it("returns the spoken line so the phone can say it before the next listen", async () => {
    const store = memoryStore();
    await handlePhoneClaim(store, "K7MQ2P");
    const saved = await saveAssistantReply(store, "K7MQ2P", "Why did the dog sit in the driver's seat?");
    expect(saved?.text).toBe("Why did the dog sit in the driver's seat?");
    expect(saved?.id).toBeTruthy();
    const body = assistantOkBody(saved, "I heard you. Say that again.");
    expect(body.ok).toBe(true);
    expect(body.say).toBe(saved?.text);
    expect(body.id).toBe(saved?.id);
    expect(assistantOkBody(null, "I heard you. Say that again.").say).toBe("I heard you. Say that again.");
  });

  it("gives the phone only the latest recent line, not the trip from hours ago", () => {
    const now = Date.parse("2026-10-20T16:00:00Z");
    const old = { id: "old", text: "You are near Lincoln. The route is still on.", at: "2026-10-20T12:00:00Z" };
    const recent = { id: "new", text: "Why did the dog sit in the driver's seat?", at: "2026-10-20T15:59:30Z" };
    expect(messagesToSpeak([old, recent], now)).toEqual([recent]);
    expect(messagesToSpeak([old], now)).toEqual([]);
  });
});
