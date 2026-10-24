/**
 * Smart route caching.
 *
 * Caches routes by hash of (origin, dest, preferences) to avoid redundant API calls.
 * Reuses cached routes when preferences haven't changed.
 */

import type { LngLat, TripPlan } from "../nav/types";

export interface CachedRoutePayload {
  plan: TripPlan;
  /** The snapped route endpoint (may differ from the raw picked coord). */
  routeDestination: LngLat;
}

interface CachedRoute {
  payload: CachedRoutePayload;
  timestamp: number;
  routeHash: string;
}

const routeCache = new Map<string, CachedRoute>();

let cacheHits = 0;
let cacheMisses = 0;

export function getRouteCacheHitStats(): { hits: number; misses: number } {
  return { hits: cacheHits, misses: cacheMisses };
}

/**
 * Default TTL for cached routes (1 hour).
 * After this time, a new route will be calculated.
 */
const ROUTE_CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Generate a hash for a route request.
 *
 * @param origin - Origin coordinates [lng, lat]
 * @param dest - Destination coordinates [lng, lat]
 * @param preferences - Routing preferences (avoid tolls, etc.)
 * @returns Hash string
 */
export function hashRouteRequest(
  origin: [number, number],
  dest: [number, number],
  preferences: Record<string, unknown> = {}
): string {
  const key = `${origin.join(",")}|${dest.join(",")}|${JSON.stringify(preferences)}`;
  // Simple hash (for production, use a proper hash function)
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    const char = key.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return `route:${Math.abs(hash)}`;
}

/**
 * Get a cached route if available and fresh.
 *
 * @param routeHash - Route hash from hashRouteRequest
 * @returns Cached route payload or null
 */
export function getCachedRoute(routeHash: string): CachedRoutePayload | null {
  const cached = routeCache.get(routeHash);
  if (!cached) {
    cacheMisses += 1;
    return null;
  }

  const age = Date.now() - cached.timestamp;
  if (age > ROUTE_CACHE_TTL_MS) {
    routeCache.delete(routeHash);
    cacheMisses += 1;
    return null;
  }

  cacheHits += 1;
  return cached.payload;
}

/**
 * Cache a route.
 *
 * @param routeHash - Route hash from hashRouteRequest
 * @param payload - Plan + snapped destination to cache
 */
export function cacheRoute(routeHash: string, payload: CachedRoutePayload): void {
  routeCache.set(routeHash, {
    payload,
    timestamp: Date.now(),
    routeHash,
  });
}

/**
 * Clear cached routes.
 *
 * Call this when:
 * - User clears trip data
 * - Routing preferences change globally
 * - Cache needs to be invalidated
 */
export function clearRouteCache(): void {
  routeCache.clear();
}

/**
 * Clear cached routes matching a pattern.
 *
 * @param pattern - Pattern to match (e.g., route:12345)
 */
export function clearRouteCacheByPattern(pattern: string): void {
  for (const key of routeCache.keys()) {
    if (key.includes(pattern)) {
      routeCache.delete(key);
    }
  }
}

/**
 * Get cache statistics (for debugging).
 *
 * @returns Number of cached routes and total age
 */
export function getRouteCacheStats(): { count: number; totalAge: number } {
  let count = 0;
  let totalAge = 0;
  const now = Date.now();

  for (const cached of routeCache.values()) {
    count++;
    totalAge += now - cached.timestamp;
  }

  return { count, totalAge };
}
