/** Turn "the nearest McDonald's" into a business search biased to where the driver is. */

export type NearbyHit = {
  id: string;
  name: string;
  detail: string;
  featureType: string;
  distanceMeters: number | null;
};

export type PreparedPlaceQuery = {
  query: string;
  /** They said nearest, closest, or nearby. */
  wantClosest: boolean;
  /** A street address should not be forced into a business result. */
  preferPoi: boolean;
};

export function preparePlaceQuery(raw: string): PreparedPlaceQuery {
  let query = raw.replace(/\s+/g, " ").trim();
  const wantClosest = /\b(?:nearest|closest|nearby|near me|around here|around me|close to me)\b/i.test(query);
  query = query.replace(/^(?:please\s+)?(?:the\s+)?(?:nearest|closest|nearby)\s+/i, "");
  query = query.replace(/\s+(?:near me|nearby|around here|around me|close to me|closest to me|nearest to me)$/i, "");
  query = query.replace(/^(?:a|an|the)\s+/i, "").trim();
  const looksLikeAddress =
    /\d/.test(query) ||
    /\b(?:road|rd|street|st|avenue|ave|drive|dr|lane|ln|boulevard|blvd|highway|hwy|court|ct|trail|way)\b/i.test(
      query
    );
  return { query, wantClosest, preferPoi: wantClosest || !looksLikeAddress };
}

/** Business hits whose name matches the words, when that is what they asked for. */
export function hitsForPlace(query: string, hits: NearbyHit[], prepared: PreparedPlaceQuery): NearbyHit[] {
  const pois = hits.filter((hit) => hit.featureType === "poi");
  if (!prepared.preferPoi || pois.length === 0) return sortByDistance(hits);
  const named = pois.filter((hit) => nameMatches(query, hit.name));
  if (named.length) return sortByDistance(named);
  if (prepared.wantClosest) return sortByDistance(pois);
  const city = hits.some(
    (hit) =>
      (hit.featureType === "place" || hit.featureType === "locality") && nameMatches(query, hit.name)
  );
  if (city) return sortByDistance(hits);
  return sortByDistance(pois);
}

export type NearbyChoice =
  | { kind: "pick"; id: string }
  | { kind: "ask"; say: string; ids: string[] }
  | { kind: "none" };

/** Two or more matches: name up to three and let the driver pick. One match can be used. */
export function offerPlaceChoices(hits: NearbyHit[]): NearbyChoice {
  if (hits.length === 0) return { kind: "none" };
  const first = hits[0]!;
  if (hits.length === 1) return { kind: "pick", id: first.id };
  const shown = hits.slice(0, 3);
  const labels = shown.map(choiceLabel);
  const say =
    shown.length === 2
      ? `I found two. ${labels[0]}, or ${labels[1]}?`
      : `I found three. ${labels[0]}, ${labels[1]}, or ${labels[2] ?? "one more"}?`;
  return { kind: "ask", say, ids: shown.map((hit) => hit.id) };
}

/**
 * One clear winner, or one question when two businesses are neck and neck.
 * "Nearest" still picks the closer one unless they are within a block of each other.
 */
export function chooseNearby(hits: NearbyHit[], wantClosest: boolean): NearbyChoice {
  if (hits.length === 0) return { kind: "none" };
  const first = hits[0]!;
  const second = hits[1];
  if (!second) return { kind: "pick", id: first.id };
  const gap = distanceGap(first, second);
  const ambiguous = gap != null && gap < (wantClosest ? 200 : 500);
  if (!ambiguous) return { kind: "pick", id: first.id };
  return {
    kind: "ask",
    say: `Two are close. ${choiceLabel(first)}, or ${choiceLabel(second)}?`,
    ids: [first.id, second.id],
  };
}

export function matchClarifiedChoice(utterance: string, hits: NearbyHit[]): string | null {
  const lower = utterance.toLowerCase().replace(/[.!?]+$/g, "").trim();
  if (!lower || hits.length === 0) return null;
  if (/\b(?:first|closest|nearest|that one|this one)\b/.test(lower)) return hits[0]!.id;
  if (/\b(?:second|other|other one|farther|further)\b/.test(lower) && hits[1]) return hits[1].id;
  if (/\b(?:third|last)\b/.test(lower) && hits[2]) return hits[2].id;
  const found = hits.find((hit) => {
    const words = `${hit.name} ${hit.detail}`
      .toLowerCase()
      .split(/[^a-z0-9']+/)
      .filter((word) => word.length > 3 && !STOP.has(word));
    return words.some((word) => lower.includes(word));
  });
  return found?.id ?? null;
}

const STOP = new Set(["mcdonald", "mcdonalds", "restaurant", "store", "street", "road", "avenue", "drive"]);

function sortByDistance(hits: NearbyHit[]): NearbyHit[] {
  return [...hits].sort((a, b) => {
    if (a.distanceMeters == null && b.distanceMeters == null) return 0;
    if (a.distanceMeters == null) return 1;
    if (b.distanceMeters == null) return -1;
    return a.distanceMeters - b.distanceMeters;
  });
}

function nameMatches(query: string, name: string): boolean {
  const q = query.toLowerCase().replace(/[^a-z0-9]/g, "");
  const n = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!q || !n) return false;
  return n.includes(q) || q.includes(n);
}

function distanceGap(a: NearbyHit, b: NearbyHit): number | null {
  if (a.distanceMeters == null || b.distanceMeters == null) return null;
  return Math.abs(b.distanceMeters - a.distanceMeters);
}

function choiceLabel(hit: NearbyHit): string {
  const street = hit.detail.split(",")[0]?.replace(/^\d+\s*/, "").trim();
  if (street && street.toLowerCase() !== hit.name.toLowerCase()) return `${hit.name} on ${street}`;
  return hit.name;
}
