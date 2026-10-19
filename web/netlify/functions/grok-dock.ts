/**
 * Grok connector. The Grok app calls this address. The phone claims a code and reads the plan.
 * Mapbox measures the drive. NWS supplies warnings. Nothing here speaks.
 */
import { connectBlobsIfLambda } from "./_blobsLambda.ts";
import {
  handleDockRpc,
  handlePhoneClaim,
  handlePhoneOrigin,
  handlePhoneRead,
  trafficNoteFromDurations,
  weatherNoteFromEvents,
  type DockHttpResult,
  type DockOrigin,
  type DockSession,
  type DockStore,
  type GeocodedPlace,
  type LngLat,
  type MeasuredLeg,
} from "../../src/grok/grokDock.ts";

type NetlifyEvent = {
  httpMethod?: string;
  headers?: Record<string, string | undefined>;
  body?: string | null;
  queryStringParameters?: Record<string, string | undefined> | null;
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
};

const memory = new Map<string, DockSession>();

function mapboxToken(): string {
  return (process.env.MAPBOX_SECRET_TOKEN || process.env.VITE_MAPBOX_TOKEN || process.env.MAPBOX_TOKEN || "").trim();
}

async function blobStore(event: unknown): Promise<DockStore> {
  await connectBlobsIfLambda(event);
  return {
    async get(code) {
      try {
        const { getStore } = await import("@netlify/blobs");
        const store = getStore("stormpath-grok-dock");
        const data = await store.get(code, { type: "json" });
        if (data && typeof data === "object" && (data as DockSession).code) return data as DockSession;
      } catch (e) {
        console.error("[grok-dock] blob read failed", e);
      }
      return memory.get(code) ?? null;
    },
    async put(session) {
      memory.set(session.code, session);
      try {
        const { getStore } = await import("@netlify/blobs");
        const store = getStore("stormpath-grok-dock");
        await store.setJSON(session.code, session);
      } catch (e) {
        console.error("[grok-dock] blob write failed", e);
      }
    },
  };
}

async function geocode(query: string, near: DockOrigin | null, token: string): Promise<GeocodedPlace | null> {
  const url = new URL(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json`);
  url.searchParams.set("access_token", token);
  url.searchParams.set("limit", "1");
  if (near) url.searchParams.set("proximity", `${near.lng},${near.lat}`);
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = (await res.json()) as { features?: { place_name?: string; center?: number[] }[] };
  const feature = data.features?.[0];
  const center = feature?.center;
  if (!feature?.place_name || !center || center.length < 2) return null;
  return { label: feature.place_name, lng: center[0]!, lat: center[1]! };
}

async function nwsEvents(lng: number, lat: number): Promise<string[]> {
  const url = `https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lng.toFixed(4)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "StormPath/4.21.4 (https://stormpath2.netlify.app)", Accept: "application/geo+json" },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { features?: { properties?: { event?: string } }[] };
  return (data.features ?? []).map((f) => f.properties?.event ?? "").filter(Boolean);
}

async function measure(origin: DockOrigin, destination: LngLat, stop: LngLat | null, token: string): Promise<MeasuredLeg> {
  const coords = stop
    ? `${origin.lng},${origin.lat};${stop[0]},${stop[1]};${destination[0]},${destination[1]}`
    : `${origin.lng},${origin.lat};${destination[0]},${destination[1]}`;
  const url = new URL(`https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${coords}`);
  url.searchParams.set("access_token", token);
  url.searchParams.set("overview", "false");
  url.searchParams.set("annotations", "congestion");
  const res = await fetch(url);
  if (!res.ok) throw new Error("StormPath could not measure the roads just now.");
  const data = (await res.json()) as {
    routes?: {
      duration?: number;
      duration_typical?: number;
      distance?: number;
      legs?: { annotation?: { congestion?: string[] } }[];
    }[];
  };
  const route = data.routes?.[0];
  if (!route?.duration || !route.distance) throw new Error("StormPath could not find a drive between those places.");
  const heavy = (route.legs ?? []).flatMap((leg) => leg.annotation?.congestion ?? []).filter((c) => c === "heavy" || c === "severe").length;
  const minutes = route.duration / 60;
  const typical = typeof route.duration_typical === "number" ? route.duration_typical / 60 : null;
  const midLng = (origin.lng + destination[0]) / 2;
  const midLat = (origin.lat + destination[1]) / 2;
  const events = [...(await nwsEvents(destination[0], destination[1])), ...(await nwsEvents(midLng, midLat))];
  return {
    minutes,
    miles: Math.round(route.distance / 1609.344),
    trafficNote: trafficNoteFromDurations(minutes, typical, heavy),
    weatherNote: weatherNoteFromEvents(events),
  };
}

function reply(result: DockHttpResult) {
  return {
    statusCode: result.status,
    headers: { ...CORS, "Content-Type": result.contentType },
    body: result.body,
  };
}

export const handler = async (event: NetlifyEvent) => {
  if ((event.httpMethod ?? "GET").toUpperCase() === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }
  const store = await blobStore(event);
  if ((event.httpMethod ?? "GET").toUpperCase() === "GET") {
    return reply(await handlePhoneRead(store, event.queryStringParameters?.code));
  }
  let parsed: Record<string, unknown> = {};
  try {
    parsed = event.body ? (JSON.parse(event.body) as Record<string, unknown>) : {};
  } catch {
    return reply({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "bad json" }) });
  }
  if (typeof parsed.method === "string") {
    const token = mapboxToken();
    const result = await handleDockRpc(parsed, store, {
      geocode: (query, near) => geocode(query, near, token),
      measure: async (origin, destination, stop) => {
        if (!token) throw new Error("StormPath routing is not configured on the server.");
        return measure(origin, destination, stop, token);
      },
    });
    if (!result) return { statusCode: 202, headers: CORS, body: "" };
    return reply(result);
  }
  if (parsed.kind === "claim") return reply(await handlePhoneClaim(store, parsed.code));
  if (parsed.kind === "origin") return reply(await handlePhoneOrigin(store, parsed.code, parsed.lng, parsed.lat));
  return reply({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "unknown" }) });
};
