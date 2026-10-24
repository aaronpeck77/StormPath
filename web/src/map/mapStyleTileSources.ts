/**
 * Warm the tiles the *style* asks for, not the ones we guessed.
 *
 * The old prefetch hard-coded `mapbox.mapbox-streets-v8`. A Mapbox style requests
 * its vector data as one **composite** source — a comma-joined tileset list in a
 * single URL — so those hand-built URLs were a different cache entry than the
 * renderer's. About said "tiles warm" while the map still went blank. Read the
 * groups off the live style instead.
 */

import type { Map } from "mapbox-gl";

/** One request group = one tile URL. Keep the comma-joined ids intact. */
export type VectorTilesetGroup = string;

type StyleSourceLike = {
  type?: string;
  url?: string;
  tiles?: readonly string[];
};

function mapboxIdsFromUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed.toLowerCase().startsWith("mapbox://")) return null;
  let rest = trimmed.slice("mapbox://".length);
  /* Some styles spell it `mapbox://tiles/<ids>`. */
  if (rest.toLowerCase().startsWith("tiles/")) rest = rest.slice("tiles/".length);
  const ids = rest
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.length > 0 ? ids.join(",") : null;
}

/** Vector tileset groups a style will request, in declaration order. */
export function vectorTilesetGroupsFromStyleSources(
  sources: Record<string, StyleSourceLike> | null | undefined
): VectorTilesetGroup[] {
  if (!sources) return [];
  const out: VectorTilesetGroup[] = [];
  const seen = new Set<string>();
  for (const src of Object.values(sources)) {
    if (!src || src.type !== "vector") continue;
    const group = src.url ? mapboxIdsFromUrl(src.url) : null;
    if (!group || seen.has(group)) continue;
    seen.add(group);
    out.push(group);
  }
  return out;
}

/** Live style's groups, or `[]` when the style is not readable (mid-teardown, dead zone). */
export function readMapVectorTilesetGroups(map: Map): VectorTilesetGroup[] {
  try {
    const style = map.getStyle();
    return vectorTilesetGroupsFromStyleSources(
      style?.sources as Record<string, StyleSourceLike> | undefined
    );
  } catch {
    return [];
  }
}

export function mapboxVectorTileUrl(input: {
  group: VectorTilesetGroup;
  z: number;
  x: number;
  y: number;
  token: string;
}): string {
  return (
    `https://api.mapbox.com/v4/${input.group}/${input.z}/${input.x}/${input.y}` +
    `.vector.pbf?access_token=${encodeURIComponent(input.token)}`
  );
}

type RequestManagerLike = {
  transformRequest?: (url: string, type?: string) => { url?: string } | null | undefined;
};

/**
 * Run our URL through GL JS's own request transform when it is reachable, so the
 * warm lands on the same cache entry as the renderer (GL JS adds a per-session
 * `sku`, and a different query string is a different entry). Falls back to the
 * plain token URL, which is still a hit for any customer `transformRequest` that
 * rewrites tiles to a proxy.
 */
export function styleMatchedTileUrl(map: Map, url: string): string {
  try {
    const rm = (map as unknown as { _requestManager?: RequestManagerLike })._requestManager;
    const out = rm?.transformRequest?.(url, "Tile");
    if (out && typeof out.url === "string" && out.url.length > 0) return out.url;
  } catch {
    /* private field moved in a GL JS bump — the plain URL is still worth fetching */
  }
  return url;
}
