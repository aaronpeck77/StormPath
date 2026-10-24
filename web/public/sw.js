/**
 * StormPath Service Worker
 *
 * Provides offline support by caching:
 * - Static assets (JS, CSS, images)
 * - Mapbox base tiles (with proper API limits)
 * - Critical app HTML
 *
 * Cache strategy:
 * - Static assets: Cache First (network fallback)
 * - Mapbox tiles: Network First (cache fallback, 24h TTL)
 * - API requests: Network Only (never cache dynamic data)
 */

const CACHE_NAME = 'stormpath-v1';
const STATIC_CACHE = 'stormpath-static-v1';
const MAPBOX_CACHE = 'stormpath-mapbox-v1';

// Static assets to cache on install
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  // Additional assets will be cached on first visit
];

// Mapbox tile pattern
const MAPBOX_TILE_PATTERN = /^https:\/\/.+\.mapbox\.com\/.+/;

// Install event - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== STATIC_CACHE && cacheName !== MAPBOX_CACHE) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch event - implement caching strategies
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip API requests (dynamic data, never cache)
  if (url.pathname.startsWith('/api/')) return;

  // Skip Mapbox Directions and Geocoding (dynamic, expensive)
  if (url.hostname.includes('mapbox.com') &&
      (url.pathname.includes('directions') || url.pathname.includes('geocoding'))) {
    return;
  }

  // Mapbox tiles - Network First with cache fallback
  if (MAPBOX_TILE_PATTERN.test(url.href)) {
    event.respondWith(handleMapboxTile(request));
    return;
  }

  // Static assets - Cache First with network fallback
  if (url.origin === self.location.origin) {
    event.respondWith(handleStaticAsset(request));
    return;
  }
});

/**
 * Handle Mapbox tile requests with Network First strategy.
 * Tiles are cached for 24 hours to respect API limits while providing offline support.
 */
async function handleMapboxTile(request) {
  const cache = await caches.open(MAPBOX_CACHE);
  const cachedResponse = await cache.match(request);

  if (cachedResponse) {
    // Check if cache is still valid (24 hours)
    const cachedDate = cachedResponse.headers.get('date');
    if (cachedDate) {
      const age = Date.now() - new Date(cachedDate).getTime();
      if (age < 24 * 60 * 60 * 1000) {
        return cachedResponse;
      }
    }
  }

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    // Network failed, return cached response if available
    if (cachedResponse) {
      return cachedResponse;
    }
    throw error;
  }
}

/**
 * Handle static assets with Cache First strategy.
 * Assets are cached on first visit and served from cache thereafter.
 */
async function handleStaticAsset(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cachedResponse = await cache.match(request);

  if (cachedResponse) {
    return cachedResponse;
  }

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    // Network failed and no cache - return offline fallback
    return new Response('Offline - no cached version available', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: new Headers({ 'Content-Type': 'text/plain' }),
    });
  }
}

/**
 * Message handler for cache management.
 *
 * Messages:
 * - { type: 'CLEAR_CACHE' } - Clear all caches
 * - { type: 'SKIP_WAITING' } - Force the new service worker to activate
 */
self.addEventListener('message', (event) => {
  if (event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then((cacheNames) => {
        return Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
      })
    );
  }

  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
