import type { LngLat } from "../nav/types";

const SNAP_URL = "https://api.openrouteservice.org/v2/snap/driving-car/json";

export type RoadSnapResult = {
  lngLat: LngLat;
  /** Street / edge name when ORS provides it */
  placeName?: string;
};

/**
 * Snap a point to the driving network (ORS). Returns null if nothing is within radius.
 */
export async function snapPointToRoutableRoad(
  apiKey: string,
  lngLat: LngLat,
  radiusM: number
): Promise<RoadSnapResult | null> {
  const res = await fetch(SNAP_URL, {
    method: "POST",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      locations: [lngLat],
      radius: Math.max(50, Math.round(radiusM)),
    }),
  });
  if (!res.ok) return null;

  const data = (await res.json()) as {
    locations?: Array<{
      location?: LngLat;
      name?: string;
    } | null>;
  };
  const hit = data.locations?.[0];
  if (!hit?.location || hit.location.length < 2) return null;
  const [lng, lat] = hit.location;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  const placeName = typeof hit.name === "string" && hit.name.trim() ? hit.name.trim() : undefined;
  return { lngLat: [lng, lat], placeName };
}
