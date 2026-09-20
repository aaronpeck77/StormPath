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

### 2026-09-19 — 435: puck at the 50, Jeff 515

Park loop again. Hold did keep a stable picture (better). Dr puck sat at midfield the whole time. Camera 0 applied / Jeff 515 / writer hard. Fail-streak was folded into holdTiles so freeze never lifted, and Jeff's resync was a bare setCenter (no 30-yard offset) plus resize. Checks exist — they were the ones slamming it to the 50.

### 2026-09-19 — Jeff vs freeze in the park dead zone

434 outbound 8 min: Core 424 @ 0.89/s, radio 128s (longest 115s), Jeff **331**, freeze 11, writer hard. Return after cell: 5 min, 39s hold, Jeff 79. Core stayed on the route. Old Jeff policy still yanked the camera during hold so the puck looked like it left the screen. Stand Jeff down on hold; one snap when the radio returns.

### 2026-09-19 — Warning polygons on Mp / Rt, never Dr

Bill wants Severe Thunderstorm / Tornado **Warning** outlines on the map, especially ahead of the front. Watches stay in the list. Dr stays clean. They were already fetched; Rt hid them after zoom 11 and convective watches still drew. Local only until after the next drive — no TestFlight from this note.

### 2026-09-19 — About dump: radio hold, freeze, trip size

Customer-safe extras so a pasted About block can tell a Wi‑Fi drop from a long-corridor stall: radio hold count + seconds, cam freeze / max fail streak / Jeff, trip bucket (`<20mi` … `100+mi`). Still no coordinates or place names.

### 2026-09-19 — Wi‑Fi drop walked the camera off the last good tiles

432 outbound: 4.1 min, Core 264 at 1.08/s, 7127 cam applies, 718 write fails, 1 map hold. Left home Wi‑Fi: camera left the yard-line and flashed other map images until cell came back. Return trip died in the house dead zone and never recovered. App-online grace keeps GO alive for 2.5s while native is already down — follow-cam kept easeTo onto missing tiles. Hold the map the instant native radio is down; freeze the last picture; one snap when the radio returns.

### 2026-09-18 — ~100 mi is where this phone starts to struggle

432 drone is good enough to leave. Bill: around 100 miles the app gets noticeably slower and some functions flake — might just be an older phone with memory maxed. Do not tune that tonight. On the drive, if it happens again, About dump plus whether Rt (full polyline + fit) is the first thing to fall over. Long-corridor work is already next to P2 tile warm; do not build a “shorten the line” hack from this note.

### 2026-09-18 — Dr→Mp is the model; Rt was a centroid smear

Bill: Dr→Mp was the one that felt right (slow rotate/flatten into a map). Rt in/out is still not one shot. Linear center from the car to the trip centroid is a smear, and fitMapToTrip could jump after the drone. Climb: hold the car while zooming out, then truck. Dive: puck pull. Do not fit a second overview after an Rt landing.

### 2026-09-18 — 431 dump: Dr→Mp is 5.1s, landing fight is gone

Parked cycle: 11 taps, drone writes 0, camera 0/0/0. Rt↔Dr and Mp↔Rt ~1400ms. Dr→Mp 5147ms and 5158ms twice. Follow-cam no longer cuts. The flatten from pitch 68 starves iOS rAF timestamps if the clock starts before the first frame. Start the 1.4s clock on the first tick; trail will show `wait3700` if Mapbox stalled before the shot.

### 2026-09-18 — Camera motion vs a dead cell

Bill: hops looked OK at home on fast Wi‑Fi; can the camera be native so a bad cell cannot wreck it? The drone `jumpTo` is already local — no radio. What a dead cell breaks is *tiles*, and any writer that waits on `isStyleLoaded` (the 91 follow-cam fails after Rt→Dr). Flipping the native map back on would get Core's tile cache, but stacking NavigationMapView under the WebView is the flicker we already turned off. Connection-proof motion is: never easeTo after a hop, hold last tiles, prefetch. Real offline corridor is P2.

### 2026-09-18 — 430 dump: hops finished, follow-cam cut the landing

Parked view cycle on 430: 8 taps, 8 start/8 done, drone writes 0 fails, every hop ~1400ms. Not a skipped shot. Camera 3 applied / 1440 parked holds / 91 write fails — enter-Dr set resync so parked hold was off, then easeTo failed on loading tiles after Rt→Dr. Linear centroid lerp also lost the puck (map flying by). Next: seed follow-cam from the landing pose, skip the enter-Dr snap, pull the path through the puck.

### 2026-09-18 — Long-drive camera: wipe the rules, not DriveMap

Bill's long drive: diagnostic 0.6s/zeros, puck vanished then came back, camera late on corners, blank map until it self-corrected, drone still rough. Do not delete DriveMap. The command rules were the mess: Jeff waited 1.5s+15s and never measured drift on the native-cam path; bearing TC 1.0s/6.5° dragged through turns; startNative reset counters on every Core reconnect. New owner is `driveCameraRules.ts` — same-frame reclaim when the puck leaves the yard-line or canvas, corner catch-up, Jeff as backup, diagnostics persist for the whole trip. Dr/Mp/Rt stays the puck-locked dive.

### 2026-09-18 — Drone hang was easeTo + a fake freeze

Field: transitions choppy, hung, or missing. `easeTo` no-ops when mid-zoom tiles make `isStyleLoaded` false — rAF kept ticking, camera sat. A failed start also set `viewFlyUntilMs` for 1.3s so follow-cam froze on a tap that never flew. Pitch lag + smoothstep made the first third look stuck. Now: linear lerp, one `jumpTo` per frame (no stop), no freeze if start fails.

### 2026-09-18 — Dr/Mp/Rt is one drone shot, never a cut

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

### 2026-09-17 - Rt→Dr: keep the puck, bird-dive, then settle

Bill still lost the puck: we were panning from the overview centroid to the car, so the map rushed past until the last street-pitch bit. New dive locks lng/lat on the puck from frame 0 (same altitude), zooms down with the puck centered, and only then pitches/offsets behind. The settle is the part he already liked.

### 2026-09-17 - Rt→Dr must descend onto the puck, not pan while zooming

Linear pose lerp from overview center to the puck while zoom 8→16.6 is the map rushing past, then a slam into Drive. Descend path: pan to the puck at overview zoom, zoom down onto it, pitch/rotate behind last. ~1.7s. Rail loop is its own 6s clock — leave the map overlay at 3.6s.

### 2026-09-17 - Drone fly + moving rail slice

Bill: the Dr/Mp/Rt cut still flicked mid-move, and the rail colors sat still like a snapshot. FlyTo zooms out then in (two shots) and the Rt/Mp resize+snap was a second writer. New owner is a ~1.1s rAF pose lerp from the live camera, restartable every tap, follow-cam/fit/resize skipped while it flies. Rail now samples a few mosaic frames along the corridor and plays them on the same loop as map radar so the cell walks the line.

### 2026-09-17 - Rail slice + view fly are pose/paint, not new owners

Two Bill ideas shipped as thin layers. Radar on the rail is the existing mosaic samples in map colors (green/yellow/red) where a cell crosses — NWS polygons stay as alert bands; indigo mosaic bands no longer cover the slice. Dr/Mp/Rt fly is a 520 ms camera move with follow-cam paused until it lands. Skip the fly on pinch, dest-hold, and compare so we do not fight those owners. If tomorrow's drive feels like the camera is late into Drive, the first suspect is viewFlyUntilMs overlapping the 60 fps loop.

### 2026-09-17 - Route casing was present and still invisible

Bill asked twice for a 2 px black outline. The layer was already there (`+4` extra = 2 px/side) and still vanished: Drive pitch plus Mapbox anti-alias covers a 2 px peek, and night mode hides black on black (he already accepted that). Street extra is now 8 with `line-blur: 0`; overview stays thinner. If he still cannot see it in day, the remaining suspect is contrast against dark pavement, not a missing layer.

### 2026-09-17 - Drive "ticks" were also Core zoom stepping at 1 Hz

Position was already following the smoothed puck, but Core's speed→zoom curve still landed raw once a second, so the frame breathed in steps on acceleration. Sep 17 polish blends zoom (TC ~1.35s, capped step) and lengthens puck/bearing/along TCs a notch. Knobs live in `driveFollowSmooth.ts` with rollback values — if Bill says it lags turns, snap those back before touching framing again.

### 2026-09-16 - Camera guards keyed on the wrong condition lock the map

Two in one night. The dest-pin floor keyed on "no routes", so every pre-trip map was pinned at ~11.2 and Bill could not pinch out to check weather - the guard's real window is "pin dropped, plan not painted" (`shouldHoldDestPlaceFrame`). And road-control icons were collected fine but never drew, because symbol placement runs bottom-up and the topmost layer yields to basemap labels. Pattern for P1: each new Drive guard needs its narrowest true condition written down, or it grows into a mode lock. Also worth remembering road controls are corridor-only by construction (Directions intersections), so nothing shows without a route - if that feels wrong to Bill later, it needs a different data source, not a wider guard.

### 2026-09-16 - Framing constants live in two places now

Tipping Drive up (pitch 64 -> 68) and zooming in (16.35 -> 16.6, highway 15.1 -> 15.35) had to be edited in `DriveFollowCam.swift` as well as the web constants: Core owns the sample, so the web value is only the fallback when a sample has no `camPitch`. Anything that looks like a "camera setting" is now a pair, and only the Swift half changes what Bill sees on the phone. Rollback values are recorded next to `DRIVE_FOLLOW_PITCH_DEG`. For P1 this argues for one shared framing source the plugin reads, instead of two hand-synced copies.

### 2026-09-19 - P1: the camera stopped being many writers

The 435 dump (0 applies, Jeff 515, puck at the 50) was not one more hold/freeze bug, it was the design: rAF follow, Jeff, drone, enter-Drive snap and the chrome settle snap each called Mapbox. Now one reducer (`driveCameraQueue`) answers one question per frame - drone > radio hold > resync > follow - and only the rAF loop writes. Jeff and the chrome snap publish intents. Steady hard-follow also writes one pose instead of setCenter-then-correct (`canPreShiftYardLineCenter`). **Reverted Sep 20 — see below.** Watch the next dump for "Cam health: freeze 0" with Jeff still counting: that would mean Jeff is sensing fine and no longer yanking.

### 2026-09-19 - Warm the zoom the driver is looking at, and the URL the style asks for

Two separate misses in the same feature. The corridor warm filled z10-13 while Drive sits at z16.6, and it built `mapbox.mapbox-streets-v8` URLs while the style requests one composite URL (plus a per-session `sku`), so "tiles warm" in About was a cache entry nobody reads. New `driveZoomTileWarm` does the next ~8 mi at z15-16 with a tight pad, groups read off the live style, and aborts the moment the radio holds. Still not P2 - no packs, no TileStore, no native map.

### 2026-09-19 - One pose, one reroute owner

The puck was fed raw GPS and snapped to the polyline in JS while Core was already map-matching the same car at 1 Hz - two opinions that only disagree in a dead zone. While Core is fresh the puck now interpolates Core's enhanced location and the DIY snap is skipped (`drivePoseSource`, About shows `puck core`). Same shape for reroute: Core owns it, DIY plans only when Core is absent, abandoned, quiet, or had 12 s after a confirmed off-route and produced nothing (`rerouteOwner`). If a future drive ever shows the puck on a frontage road while the banner is right, the suspect is Core's matching, not our snap - check `puck core` vs `puck gps` first.

### 2026-09-20 - P1: freezing the camera is worse than showing bare tiles

Build 438, two drives, Wi-Fi dropping as he pulls away. Core was perfect both times (1.03 and 1.06 samples/s, `puck core` the whole way). The camera still died, and it died *because I told it to*: `radioHold` returned `freeze`, and he held the radio 125 s of a 240 s trip and 108 s of the second. Zero camera writes for that whole stretch, so the puck drove off a stationary map - exactly what he described. The freeze was inherited from the 434/435 era when Jeff was yanking the camera 515 times; the queue had already removed that thrash, so the tourniquet was doing nothing but harm. `safePanToCenter` needs `isStyleLoaded()`, but `safeHardFollowCamera` is a direct transform write that works with **no tiles at all** - so a held radio now means keep following on the hard writer and let missing tiles paint as background, which is what Apple and Google do. Second half of the same dump: trip 2 ended on `writer pan` with **137 write fails and 24 freezes**, because the latch flipped back to pan 3 s after the radio claimed to be up while tiles were still missing. A failed pan now latches hard for the clear window. Lesson worth keeping for P1: "hold the last good picture" is a *tile* policy. Applying it to the camera trades a blurry map for a lost puck, and the driver notices the lost puck.

### 2026-09-20 - P1: never guess where Mapbox put the center

439 made Go unusable - the puck swung a half block left and the camera stared at blank map - and the cause was not the hold change, it was a micro-optimization from the same batch. Steady hard-follow had started folding the yard-line offset into the center to save one `setCenter` per frame (`canPreShiftYardLineCenter`), which assumes `setCenter(X)` lands X at canvas middle. It does not: `easeTo({ padding })` leaves **persistent** padding on the transform, so `setCenter` lands X at the *padded* center. Our own padding-derived shift then double-counted it. In portrait the error is vertical and small enough to read as sloppy following; in his landscape right-hand layout the left/right padding is asymmetric, so it threw the puck sideways. It only surfaced now because 439 routes far more frames through the hard writer - at Go the style is still loading, pans fail, the writer latches hard immediately. Back to write-then-`project`-then-correct: measuring where the center actually landed is the only version that is padding-proof, and one extra `setCenter` per frame is not a cost worth a wrong frame. Added a sanity radius too, because at pitch 64 the corrected screen point can sit near the horizon where `unproject` returns a point kilometres out - that would put the camera on empty map the same way. Two for the P1 list: a camera optimization that removes a *measurement* is not an optimization, and landscape asymmetric padding needs to be in the test matrix, not just portrait.
