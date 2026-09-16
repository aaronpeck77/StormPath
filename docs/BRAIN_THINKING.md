# Brain thinking log

Scratchpad for ideas we keep chewing on while other work is in progress. **Not a build queue.** Do not implement from this file. Promote a thought into `docs/BRAIN.md` if it changes the parked design; leave drive-by notes here.

**Rules:** Dated entries. One idea per block. If it would take more than a paragraph, you are designing the feature — stop. No commits required for a thought, but do not sneak code in “while thinking.”

---

## P3 — Interstate / freeway jam bypass

### 2026-09-12 — First chew (Bill: this is what sells interstate travel)

The hours-long standstill is almost never “you are at the wreck.” It is **you entered the back of the queue** while the cause is still miles ahead. Our old window is “2 miles before the incident pin.” That pin is often the **cause**, not the **tail**. If the queue already backs up past the last good interchange, a surgical hop from the wreck pin is too late.

When we build this, the first hard problem is **find the tail of the slowdown on the locked interstate**, then ask: is there still an exit *before* that tail? If no, do not offer a bypass — just tell the truth (“you are already in it”). If yes, the product moment is one voice line with a number: last easy exit, minutes it might save. That is what people will pay for.

Mapbox already gives duration / congestion along the line. Core (P1) must **accept** the hop as the live route. A web polyline swap that Core “fixes” back onto the jam is the last fight all over again. Offline download (P2) will not have live traffic — this feature needs cell, and the UI should say so.

Do not auto-take until that hop is boring: right exit, not a farm loop, on-ramp past the cause. Warn + one tap first.

---

## P2 — Download this trip

### 2026-09-15 — Predictive cache has two halves; only one survived the map swap

`PredictiveCacheConfig()` is still set on `CoreConfig`, so Core keeps caching the **routing graph** along the trip — that is why guidance, snap and reroute survive a dead cell. The **map tile** half only fills when `provider.predictiveCacheManager` is handed to a `NavigationMapView`, and with `NATIVE_DRIVE_MAP_ENABLED = false` nothing takes it. TileStore is also unreadable from the WebView: private pack format, native process, no per-tile byte API.

Our JS stand-in (`routeCorridorPreload` + `prefetchMapTilesForBounds`) warms z10–13 while Drive follows at 16.35, so a dead cell falls back to a stretched z13 parent — roads, no streets. Two cheap follow-ups when Bill asks: a short high-zoom window (next ~8 mi at z15–16, tight pad) and confirming our single-source `mapbox-streets-v8` URLs actually match the composite+`sku` URLs the style requests, or every warmed tile is a cache miss.

Real parity would be a `WKURLSchemeHandler` tile proxy in Swift serving GL JS from disk. That is the foundation P2 wants anyway — do not build it until he asks.

---

## P1 — Native-feel Drive

### 2026-09-12 — Stop after Go

Core must go idle and drop the NavigationMapView **before** the web trip is wiped. Nilling `MapboxNavigationProvider` while the map is still subscribed (or while `setToIdle` is in flight) is a hard crash. Same rule when P3 later installs a hop: never swap the web line while Core is still the live session.

### 2026-09-13 — Corridor warm stole the camera

Pre-Go Wi‑Fi tile warm used `fitBounds` on the first ~25 mi window, then restored — that was the A/B “first leg then full route” hop. Prefetch HTTP only; leave the overview camera alone.

### 2026-09-13 — Stop still crashed after idle+drain+nil

Even with mutex + 550ms drain, releasing the provider on Stop killed the IPA. Soft-stop now: `setToIdle`, drop sinks, **keep** the provider (Mapbox’s own pattern). Full nil only on the next prepare/Go under the mutex. Do not bring back a second overlapping provider.

### 2026-09-13 — Full native Drive (one owner)

Bill: no baby steps. `NATIVE_DRIVE_MAP_ENABLED` + follow-cam **on**. After Go in Dr, NavigationMapView is the road; web map punches transparent and does not easeTo. Mp/Rt still web. Soft-stop stays required so turning the shell on does not reintroduce the Stop crash.

### 2026-09-13 — Go jump, no puck, Stop crash

Go: hold planning frame until native reveals (one cut). Puck: keep web DOM puck over transparent canvas; native puck scale back to 1. Stop: soft-stop skips `setToIdle` (crash suspect); idle only on next prepare/Go tearDown.

### 2026-09-13 — Stop “Something went wrong” is JS, not kill

Bill clarified: Stop does not close the IPA — ErrorBoundary + Reload. Likely TurnBanner / stay-on copy calling `.replace` / `.toLowerCase` on a cleared native instruction mid-render. Soft-stop stays; harden banner + icon paths. Puck: drop flat 2D disc for `.puck3D(.navigationDefault)` once pitched.

### 2026-09-14 — RainViewer needs the same proxy idea as Tomorrow.io

Netlify/Cloudflare already shielded TIO tiles. Animated radar still hit `tilecache.rainviewer.com` per phone → public 429 → overlay off. Proxy + edge cache for RV tiles (Netlify function + Worker) so animation can stay on at scale.

### 2026-09-14 — Cloudflare Worker when customer count hurts radar

Bill: save for later. Netlify RV proxy first; if many users bring rate limits back, remind him to deploy `cloudflare/rainviewer-tiles` + `VITE_RAINVIEWER_TILE_PROXY_URL`. Parked in `docs/BRAIN.md` + `.cursor/rules/rainviewer-scale-cloudflare.mdc`.

### 2026-09-14 — Explain now-map vs when-you-arrive weather

Drivers see a cell on live radar but no Route Info alerts (or clear map + storm ahead) and think we missed it. We already ETA-sample corridor wx and suppress NWS that end before arrival (`hazardArrivalVerdict`). **Shipped (advisory ticker only):** `corridorTimingExplain` Timing lines in StormAdvisoryBar — storm-on-map/clear-by-ETA, clear-now/storms-by-Mid, and may_pass NWS phrasing. No new map chrome.

### 2026-09-14 — Planned trips looked storm-blind

Ultra-long pre-Go Route Info blanked outlook graphs; Dr browse with Rad off skipped radar sampling; ETA radar clamped past nowcast to a clear last frame; high POP on “Cloudy” was zeroed on the rain chart. Fix: lean outlook while planning, sample radar on pre-Go Dr, max(now,ETA) echo, show elevated POP.

### 2026-09-14 — Corridor hours must use Mapbox plan ETA

Bill: Eau Claire ~6–7h, 100% thunderstorms at arrival on weather apps, StormPath graphs/alerts clear. Root: waypoints stamped ETAs from parked speed fallback (~34 mph) so we sampled the wrong forecast hour along the corridor; graph then keyed those hours against Mapbox’s real duration. Fix: stamp waypoint ETAs from `baseEtaMinutes`, invalidate mis-timed cache, denser WeatherKit corridor points.

### 2026-09-14 — Graph scale + Go camera

Bill: rain/wind responding but want more curve movement; Go zooms a random spot then puck. Tighten precip/wind/radar chart scales. Drop first-Go overview hold — snap Dr to current location immediately.

### 2026-09-14 — Go still needs web until native punches

Bill: after dropping the hold, Go jumped between images then sat on the old customer web map before native. That web layer is intentional — hole punches only after native is framed. Fix is freeze web on the planning frame (no street follow-cam) until punch, one cut — not delete the web map.

### 2026-09-15 — Follow-cam turn anticipation is distance-only

Web route bearing samples ~28–110 m ahead (`speed * 3.2`), then COG vetoes if >55° off. Maneuver steps know turns for banner/off-route only — no camera anticipation. Native `DriveFollowCam` uses heading only, no polyline look-ahead. Small lever: bump `lookAheadM` in `computeDriveRouteBearing` (or ~2–3 s × speed when near `metersToCurrentStepEnd`).

### 2026-09-15 — Go lock vs silent soft restart

Go locks the previewed chip (`goLockRoute.ts`); Drive guidance follows that id. Contract says soft restart should keep no-interstate via `preferBackroads`, and `lockedRouteShouldAvoidMotorway` feeds native Core — but DIY `softRestartRouteFromHere` still fetches multi-route without `preferBackroads` and relocks onto new Main (`r-a`). Plus Drive still shows the blue A/B cycle chip and map alts. Tightening lock-after-Go is mostly: pass preferBackroads on soft restart, hide RoutePick in DR, hide map alts when `viewMode === "drive"`.

### 2026-09-15 — Road controls on both maps; one-map direction

Bill wants StormPath's look with native function. Worth remembering both maps already load the same style URL, so the split is renderer + paint, not basemap. Signals / stop / yield / rail now come from Directions `intersections` (data we already fetch) and draw on the web map and the native Drive map — proof that "native-only" detail is often just route data. Direction agreed for later: stop stacking two live maps in Drive, keep one renderer and bridge the other's data. Mapbox Standard is the optional third step but re-shuffles ~29 custom layers.

### 2026-09-15 — Drawn dome puck, rail warm-up, class speed limits

Mapbox's only bundled 3D model is the arrow Bill dislikes, so the puck is now a drawn dome (gradient + specular + ground shadow + short course nose) via `Puck2DConfiguration` images. Real 3D later means bundling our own `.glb`. Rail stays hidden until Go but its corridor data now warms as soon as a destination is set (`preGoRailWarm`), which also removes the pre-Go mis-tap that moved the destination. Lim falls back to a road-class average (interstate 70 / state 55 / county 55 / city 30, averaged from IL, MO, IN, OH, KY codes) marked `~est` and excluded from the over-speed warning.

### 2026-09-15 — Puck back to 3D, colors, rail after Go

Bill wants the 3D puck kept (just not lane-sized), so native uses `Puck3DConfiguration.navigationDefault` scaled 0.7 instead of the flat 2D disc. Rt/Mp now read like Drive: taken leg is the same sky blue, unused leg pale blue. Progress rail only after Go — note Route info opens from that rail, so pre-Go corridor graphs need another door if he wants them while planning. Speed limit: Apple exposes no public posted-limit API; Core's `SpeedLimit` off nav status is the accurate path vs static Directions `maxspeed`.

### 2026-09-15 — Drive-test fix pack shipped

Bill’s seven items: lock DR (no A/B chip/alts; soft restart preferBackroads; B auto-tags +ETA); mild turn look-ahead; shell transparency only after punch; slim route + 2D puck; YOU rail from polyline progress not odometer=0; native route under road-label.

### 2026-09-15 - MapboxMap is IUO; binding it to a let breaks the archive

Second time this has cost a CI run (c771eaa buildings, 16ff5ee road controls). `map.mapView.mapboxMap` is `MapboxMap!`: chaining straight off it compiles, but `let style = map.mapView.mapboxMap` decays to `MapboxMap?` and every member call after it errors - one line, ten annotations. Always `guard let style = map.mapView.mapboxMap else { return }`. Web tests never catch this; only the iOS archive does.

### 2026-09-15 - Parked twitch: the native cam path skips the puck's damping

Bill sitting still, map twitching. The smoothed-puck loop damps stationary GPS wobble hard (blendTc 2.4s), but the native-cam branch writes Core's raw sample straight to the map, so the puck sat still while the camera hopped. Fixed with a parked hold (12 m / 25 deg, released by driveCamResyncRef) in `shouldHoldParkedFollowCam`. Lesson for P1: every camera owner needs its own stationary gate - one owner on the Core side does not inherit the web loop's smoothing.
