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

### 2026-10-24 — Build 543: the banner hit exactly the predicted failure

Bill hit Go and got the hop panel ~an hour before the jam — giant dead box, taps ignored. Fixes shipped: renders inside the top cluster now (pointer-events + strip sizing), 5 mi lookahead gate when not yet in the queue, dismiss keyed on the stretch (800 m buckets) not the speed-jittered leaveBy, title carries the distance ("Backup ahead · 3.0 mi"). Chew: the lookahead is time-blind — 5 mi at 70 mph is ~4 min, but on paper the offer only exists within that window or in-queue. If Bill reports the strip feels "sudden," the next knob is a second earlier heads-up tone (info pill, not a banner) vs. extending the window.

### 2026-11-06 — Bill: P3 is essential, arguably the reason the app exists

After the 566 batch he said P1 feels done and P2 may never be needed if the app keeps working this well — but P3 is essential, one of the reasons he started StormPath. That raises the stakes on the two known hard parts rather than the UI: (1) Core must accept the hop as the live route or the web swap gets "fixed" back onto the jam; (2) it needs live traffic, so dead-zone behavior must degrade honestly (warn, don't offer). Next chew when he green-lights it: what "essential" means concretely — likely warn-first + one-tap accept on a locked corridor, not auto-take, and the offer should key off the queue tail not the incident pin (the Sep 12 note). Do not start until he asks AND the 566 drive test is reported.

### 2026-11-06 — P3 offline reality check: trip download makes the app survive, not the bypass

Bill asked whether a WiFi-downloaded trip could carry a driver to destination through dead zones. Verified against Mapbox Navigation v3 docs: `TileStore` offline regions include the **routing graph**, so offline turn-by-turn AND onboard rerouting work without cell — better than the earlier assumption. Still needs signal: live traffic (P3's input — probe data can't be prefetched), live radar/nowcast. Forecasts snapshot fine at download time (daily/7-day hold for days; hourly/radar stale — the "Offline — saved phone snapshot" labeling already exists in `buildCarConditions`). Constraints: offline-region tile limits vs corridor size (over-the-road highway-zoom profile or per-section packs — ties to the multi-day idea), source-composited styles break predictive caching, 500-tile ToS budget. Design shape: downloaded trip = app never dies; P3 fires only with signal and says so honestly in dead zones. Same dead zones that kill traffic are where interstate jams live, so this pairing is the product, not a compromise.

---

## P2 — Download this trip

### 2026-09-15 — Predictive cache has two halves; only one survived the map swap

`PredictiveCacheConfig()` is still set on `CoreConfig`, so Core keeps caching the **routing graph** along the trip — that is why guidance, snap and reroute survive a dead cell. The **map tile** half only fills when `provider.predictiveCacheManager` is handed to a `NavigationMapView`, and with `NATIVE_DRIVE_MAP_ENABLED = false` nothing takes it. TileStore is also unreadable from the WebView: private pack format, native process, no per-tile byte API.

Our JS stand-in (`routeCorridorPreload` + `prefetchMapTilesForBounds`) warms z10–13 while Drive follows at 16.35, so a dead cell falls back to a stretched z13 parent — roads, no streets. Two cheap follow-ups when Bill asks: a short high-zoom window (next ~8 mi at z15–16, tight pad) and confirming our single-source `mapbox-streets-v8` URLs actually match the composite+`sku` URLs the style requests, or every warmed tile is a cache miss.

Real parity would be a `WKURLSchemeHandler` tile proxy in Swift serving GL JS from disk. That is the foundation P2 wants anyway — do not build it until he asks.

### 2026-10-24 — "Route pending" replaced the return-trip reversal

The old Brain P2 offline fallback (reverse the saved inbound leg within ~500 m) is gone. In its place: a dead-zone plan/search now queues one `PendingRequest` (persisted 6 h), a banner says "will appear when data returns," and a retry hook replays it 1.5 s after the radio flips online, then every 30 s. It lands in the normal RT preview and waits for Go — never auto-navigates. Worth chewing: this is the first time a *user intent* survives a dead zone instead of a *route*. If P2 ever ships, the pending queue is the natural place to offer "download this trip" once the driver commits — the request already knows its destination.

### 2026-10-24 — GL's tile cache was the real hole, not the warming

Turns out our z10–16 warming wasn't wasted effort — mapbox-gl's own Cache Storage deletes every entry it *reads* and never re-puts it, so warm tiles evaporate on first use. The fix shipped today wraps the global `fetch` (main thread for style/sprites, a `?w=` worker shim for vector tiles) and mirrors mapbox.com map resources into IndexedDB (6k cap, LRU, 6 s network race). Also stopped downloading the native corridor pack while `NATIVE_DRIVE_MAP_ENABLED` is off — it filled a TileStore nothing renders. Interesting frame for P2: "offline" is now a fetch-layer concern, not a pack-download concern — the native pack path may end up dead weight unless the native map comes back.

### 2026-10-24 — Offline map budget = 500 pieces

500 matches mapbox-gl's default tile cache count (deliberate — Mapbox ToS 3.2 line). Everyday profile shipped: home 300 / route corridor 160 / essentials 40, z≤13 only, offline zoom clamp 13.9 so the camera can't drift into zooms nothing saved. Basic users get a home bucket if they've saved a place named "home" (12 km box). Parked: pro-driver profiles spend the same 500 at different zooms — local delivery = whole metro at street level; regional = ~300-mi region at highway zoom + repeat routes; over-the-road = corridor ahead at highway zoom (~400–500 mi), drop behind fast; auto-pick from learned driving, manual override. Industry miles (ATA): long haul ~500 mi/day, 100–110k/yr; regional/city ~48k/yr; local P&D 150–250 mi/day.

### 2026-11-06 — P2 model: opportunistic corridor cache, not an all-or-nothing download

Bill's frame: grab what you can while signal exists, keep updating as it comes and goes — not a binary "downloaded vs not." Most of this already exists (driveZoomTileWarm, routeCorridorPreload, IndexedDB fetch mirror, PredictiveCacheManager, PendingRequest replay); the real gap is retention — corridor should be *pinned* for the trip, not LRU-evicted. True 100-mi dead zones are rare in the US (mountains/desert corridors, a few miles typical); deliberate trip download only matters for long-haul edge cases + international. Weather/road data can't be prefetched — degrade to timestamped snapshots ("weather from 9:42 PM") using the existing "Offline — saved phone snapshot" pattern; traffic/P3 offers simply don't exist without signal. Forecasts fetched at trip start cover the corridor for days (daily/7-day hold; hourly/radar stale).

### 2026-11-06 — Bill brainstorm harvest: weather-forward features he loves

From the "what do other apps do" pass — Bill loves the whole weather-forward group ("that is what StormPath was named for"): departure-time weather optimization (leave at 6am to beat the storm — nobody does weather-based leave-by, only traffic-based), pre-trip briefing card (hazards + storm windows + best departure in one screen), "why this route" alternate explanations (weather-driven vs traffic-driven — we know which after the woggle filter), wildfire smoke/AQI routing, and 511/DOT condition feeds. On 511s: no national API exists (~50 state systems, some gated, some nothing), BUT aggregators already solved it — Road511 covers 64 US/Canada jurisdictions as normalized GeoJSON (incidents, closures, chain controls, weather); Argus AI and Live Roads USA similar. Realistic path = one paid aggregator contract, not 50 integrations. Don't-bother list Bill agreed with: crowd-sourced reports (Waze's moat), truck/RV vehicle profiles (different product), AR/dashcam.

### 2026-11-06 — Bill brainstorm harvest: logistics + glanceable surfaces

Bill's verdicts: EV charging — parked (native EV nav already does it; PlugShare later if users ask). Leave-by-time — feasible despite app shutdown: iOS local notifications fire when the app is terminated, so schedule-at-plan-time works; needs advance planning + traffic estimate ages. ETA sharing — loves it; v1 = StormPath-branded share card via iOS share sheet (destination/ETA/arrival/route snapshot), v2 = live link like Google Maps (needs lightweight backend). Mileage/trip log — loves it ("smart"); niche but high-value (gig/sales/reimbursed mileage, ~$0.70/mi IRS rate), data mostly exists in tripCache+Core, CSV export, Plus-tier candidate. Live Activity — explained it's the PHONE lock screen + Dynamic Island, not CarPlay (food-delivery-tracker style live maneuver/ETA, ActivityKit iOS 16.1+); cheaper alt = static widget. Apple Watch — wants StormPath styling + seasonal logo; v1 = free notification mirroring + ETA complication, full watchOS app = real project.

### 2026-11-06 — Bill idea: multi-day trips as sections of one corridor

RV/truck apps (PC*Miler, CoPilot, RV LIFE, Roadtrippers) do this natively; consumer apps fake it with waypoints. StormPath is closer than it looks: `routeWaypoints` already routes origin → via → destination (`MAX_VIA_STOPS = 1`), `tripCache`/`useActiveTripCache` already survives overnight restarts, and the whole hazard/weather pipeline runs on one polyline — sections would be named overnight milestones along it, not separate routes. The product argument FOR one corridor vs daily re-plan: corridor foresight is the whole value — day-3 weather known on day 1 ("storm reaches your Thursday segment — leave a day early"). Daily re-plan fragments offline packs and loses that. Depends on P2 per-section packs to matter in dead zones; niche (Plus tier, RV/snowbird/long-haul). Parked behind P2.

---

## P1 — Native-feel Drive

### 2026-11-07 — Mp centers via padding, not offset — the jumpTo lesson generalized

The iPad landscape Mp puck was centering on the raw viewport, ignoring the side command panel. Fix: `resolveTopdownPanelPadding()` reserves the panel's measured width as camera *padding* on every topdown write (drone target, RAF follow, flyTo/jumpTo fits, planning recenter). Padding was the right tool because `jumpTo` ignores `offset` but honors padding — the same reason Dr needed the ground-space yard-line solve. Chew: the panel-aware padding is now duplicated knowledge — `navSidePanelInset()` measures DOM while `driveCameraEaseOptions` and `measuredMapChromeInsets` each compute their own reserve for the same panel. If a third consumer appears, collapse them into one "map-area insets" source of truth; the cheap-key cache in mapTopdownCamera is the pattern to copy if it stays DOM-measured.

### 2026-11-05 — Hard-lock Stage 1: the lock now means "his line," and DIY is the next fight

Bill's stated product rule after the 564 drive: an accepted route never changes silently — deviate → guide back; a better option only via a prompt he approves. Shipped locally: `nativeRouteChangedShouldForce` no longer force-adopts mid-trip Core geometry on an alternate pick, so disagreement falls to DIY's off-route machinery (which has rejoin-to-corridor stubs). Chew the trap: `MANUAL_OFF_ROUTE_CHOICES_ENABLED = false` means DIY's soft-restart still replans *silently* — Stage 1 moved the silent switch downstream rather than removing it. If the next drive still flips, the real fix is an approval gate on DIY replan results (offer "faster now — take it?" instead of swapping). Also: `lockPick` diagnostics now record which chip+pref was locked at Go — `lock fastest` only ever meant preferBackroads, which is why 564 dumps couldn't answer "did my alternate survive." Watch via-stop semantics next: Bill adds stops to shape routes then must remember to skip them — stop-as-waypoint vs stop-as-destination is a UX knot worth its own pass.

### 2026-11-05 — Phone as companion, not second nav screen

Bill proposed hiding the phone's map while CarPlay drives and showing details instead — built as `CarPlayCompanionView` (local commit `af159f4`, unpushed). It renders the *same* `buildCarConditions` snapshot the car summarizes, so phone and car can't disagree by construction. Chew: this is the right long-term split — CarPlay = glanceable drive, phone = intelligence. If it drives well, the next step is pushing more phone-only depth into it (full progress rail, radar loop, minute-by-minute precip) since the screen real estate is free. Watch: `carPlayConnected` polls `connectedScenes` every 2s — if the scene lingers after the car screen sleeps, the phone could stick on companion; field test will tell.

### 2026-11-03 — 559 drive: CarPlay wants to hide, and reroutes must respect the alternate pick

Bill's 559 feedback clusters into two truths. First, chrome: he wants Apple's own auto-hide nav bar back (now `automaticallyHidesNavigationBar`/`hidesButtonsWithNavigationBar` true), radar scoped to RT only, a black guidance area, and the puck back to stock size in his phone color. Second, ownership: he picked the alternate and a missed turn dumped him on the main line — mid-trip Core `routeChanged` is still force-adopted when off the corridor, and Core's reroute is always *its* fastest. Local change: when `routingPreferenceRef` is "alternate", a mid-trip emit is no longer force-adopted; the agreement check rejects it, the trip abandons to DIY, and DIY replans honoring the preference. Watch next drive: if no alternate qualifies, DIY still lands fastest — same outcome, but by choice of policy not by accident. Chew later: CarPlay hazard popup now uses `CPNavigationAlert` pointing at the phone; a colored route-casing severity band is the only remaining way to put weather *on* the line itself without a custom map source.

### 2026-11-02 — CarPlay needs weather without a second navigation owner

Bill authorized RT radar and weather/hazard access after the first 556 drive: native radar can remain a map layer while the phone's Core session still owns guidance. Carry the shared timeline and forecast values through the existing snapshot bridge into native lists rather than invent another hazard model or paste the phone graph into the base view. Radar refresh must not depend on a foreground WebView; forecast snapshots must disclose their age when that WebView sleeps. Observed radar and arrival-time forecasts answer different questions. Local implementation is not Swift-compiled or car-tested yet; this is not permission to ship, enable P2 packs, or turn on P3.

### 2026-11-01 — First CarPlay drive: preserve smooth guidance, adapt the chrome

Bill drove 556 mostly on CarPlay: smooth route motion and liked the dark casing, but route too thick over road information, puck small/flat, only one maneuver, and StormPath lost the dock slot after switching to audiobook. Faulty phone port caused disconnects; do not attribute those to software. Current code supplies only one CPManeuver; Apple supports multiple but controls visibility. Keep StormPath's map identity while using approved CarPlay templates, not a copy of the phone's interactive rail/advisory chrome. Verify navigation-session continuity across app switches and cable reconnects before expanding UI. Phone Core/camera counters during CarPlay/background use are not proof of car-screen stalls. Speed-limit sign locations need known geolocated data, not guessed placement from a current-road limit. No feature changes authorized by this note.

### 2026-11-01 — Bend should own its gesture, not the toolbar

Bill's 554 test opened Bend but normal map gestures still won. Capture route pulls before map gestures and cancel cleanly on interrupted/multi-touch input. Keep manual Bend in Route Info only on sustained qualifying open roads; promote it through the shared hazard ticker for a serious crossing ahead. Road names plus known speed samples are a conservative proxy, not a rural-boundary detector. A must-visit bend does not prove hazard avoidance; do not conflate this with P3 automatic jam bypass. Phone validation remains required. Keep 554's App Store submission unchanged.

### 2026-10-26 — Containment must not hide directions

Bill's 550 check caught the difference between containing overflow and fitting text: landscape TBT stayed within its border but clipped the instruction. Use compact readable landscape type, remove the three-line truncation there, and let content determine panel height rather than hiding the bottom. Phone checks still need long road names and both handedness settings.

### 2026-10-26 — Shared hazard identity makes the graph readable

Bill wants the graph to keep its long-trip horizontal detail while cards remain vertically readable. NWS/ROAD marks now link by the same timeline IDs to their cards (including beyond the old six-card limit); overlap offers a choice, and card selection highlights the matching mark. Drive status bar is the name for the lower landscape message/countdown area. Keep landscape status content there even while its target mounts, never briefly over TBT. Test phone gesture handling and long turn names before treating CSS containment as visually verified.

### 2026-10-26 — Recovery needs an exit as well as an entry

548's low accepted Core sample counts exposed the other half of the rejection handoff: an accepted replacement must clear abandonment before progress can resume. A listener regression now exercises accept → reject → accept twice. Bill's landscape control-side dock keeps transient messages and the hazard countdown beside miles remaining, away from the notch and opposite-side map. Device checks still need to establish smooth turns, catch-up behavior, and both handedness layouts; do not infer those from passing unit tests.

### 2026-10-25 — The abandoned handoff nobody wired

Bill's 547 drive: TBT stuck/flip-flopping ~40 min, off-route latched 2322 s, rerouted line invisible until a view flip. Root suspect: `nativeAbandonedRef` was reset but never set — a *rejected* mid-trip Core `routeChanged` left Core feeding stepIndex/instruction from a corridor we refused to draw, while DIY was barred from rerouting (owner=core). Now a rejected mid-trip emit abandons the trip to DIY and drops its progress. Watch next drive: does DIY replan + Core restart happen quickly after a guard rejection, and does anything else need to know the old session is dead underneath?

### 2026-10-25 — Drive ticker shares the hazard timeline

Bill authorized the Plus-only Drive countdown for tomorrow's longer commutes. Keep this a small projection of the same timeline as the rail and Route Info: nearest relevant crossing, along-route distance, matching severity color. Hide offline and yield within a mile of a maneuver; do not imply that missing data means a clear road. Tomorrow's drive should tell us whether that yielding window is too conservative on local roads. Route-line tinting remains separate.

### 2026-10-24 — Long-trip speed must not remove guidance

Bill's 1,452-mile test exposed the 300-mile optimization disabling turn steps, leaving a placeholder that looked like arrival. Keep maneuver instructions even when heavy annotations are skipped. A missing next step is incomplete guidance, not evidence of arrival; long-haul reliability depends on keeping those states separate.

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

### 2026-09-20 - P1: pixels are not metres at pitch 68

Same report, second and deeper cause: the puck would not *stay* on the 30, it kept wanting midfield. The hard-write path solved "put the puck on the anchor" by reflecting the anchor across the center **in screen pixels** and unprojecting that. Under pitch that is simply the wrong operation. At pitch 68 a row 72 px above center is ~3.7 camera-heights out and a row 72 px below is ~1.8, so the reflection asks for roughly double the real shift - the puck gets thrown toward the bottom edge, Jeff reads severe drift, resyncs, and the resync repeats the same overshoot. A yard line that never settles. The right solve is the one Mapbox uses internally in `setLocationAtPoint`: unproject the anchor to ground, take its Mercator offset from the center, and put the center that same offset *behind* the puck. Ground space is translation-invariant so it is exact, in one step, with no iteration. Filed under the same lesson as the padding double-count above: the pan path had this right the whole time because `easeTo({ padding, offset })` calls Mapbox's solver, and every bug in this area came from re-deriving that solver by hand in pixel space. If the hard path ever drifts again, compare it against what `easeTo` would have done before touching anything else.

### 2026-09-20 - P1: never guess where Mapbox put the center

439 made Go unusable - the puck swung a half block left and the camera stared at blank map - and the cause was not the hold change, it was a micro-optimization from the same batch. Steady hard-follow had started folding the yard-line offset into the center to save one `setCenter` per frame (`canPreShiftYardLineCenter`), which assumes `setCenter(X)` lands X at canvas middle. It does not: `easeTo({ padding })` leaves **persistent** padding on the transform, so `setCenter` lands X at the *padded* center. Our own padding-derived shift then double-counted it. In portrait the error is vertical and small enough to read as sloppy following; in his landscape right-hand layout the left/right padding is asymmetric, so it threw the puck sideways. It only surfaced now because 439 routes far more frames through the hard writer - at Go the style is still loading, pans fail, the writer latches hard immediately. Back to write-then-`project`-then-correct: measuring where the center actually landed is the only version that is padding-proof, and one extra `setCenter` per frame is not a cost worth a wrong frame. Added a sanity radius too, because at pitch 64 the corrected screen point can sit near the horizon where `unproject` returns a point kilometres out - that would put the camera on empty map the same way. Two for the P1 list: a camera optimization that removes a *measurement* is not an optimization, and landscape asymmetric padding needs to be in the test matrix, not just portrait.

### 2026-10-24 - P2 opened: park dead-zone postmortem — boot restore already works, tiles are the gap

Bill's park trip (build 535): arrived, ended trip, killed app, reopened in dead zone — blank map, no puck, can't plan. Trace: `useActiveTripCache` already restores saved trips on cold boot, so boot ordering was NOT the failure. Real gaps: (1) trip was ended → nothing to restore; (2) park-area tiles never cached — driveZoomTileWarm only warms ~8mi ahead while driving, not destination; (3) planning needs network or cached nav tiles. Corrective: the actual build is TileStore corridor packs + home region in the native plugin (StormpathMapboxNavigationPlugin.swift) — TileStore persists on disk across kills. Web-side "dead-zone boot" work is mostly already done.

### 2026-10-24 - Bill's idea: sliding-window boundary in RT view

Show the cached corridor as an outlined bubble on the RT-view route that moves in real time — user sees exactly what works offline. Feasible: corridor polygon (position → ~200mi ahead) as a Mapbox fill/line layer. Style subtle (dotted boundary/light shade), RT view or offline only. Polish item after the window exists — not P2 core.

### 2026-10-24 - P2 build start: plugin structure found, TileStore gap confirmed

Plugin: `web/plugins/stormpath-mapbox-navigation/ios/Sources/StormpathMapboxNavigationPlugin/` — DriveNativeMap, DriveFollowCam, DrivePoseHold, DrivePuckOverlay, HorizonAhead, StormpathMapboxNavigationPlugin.swift. Existing: `PredictiveCacheManager` + `PredictiveCacheConfig` already wired (in-drive warm). MISSING: any TileStore/offline pack API — no `TileStore`, no `OfflineRegion`, no corridor pack call. Build target: add `TripOfflinePack` manager (TileStore corridor + home region) alongside PredictiveCacheManager, expose to web via Capacitor bridge methods (startCorridorPack/estimatePackSize/cancelPack/removePack/homeRegionSet).

### 2026-10-24 - Bill idea: next-hazard countdown ticker (Dr/Mp) + route-line hazard tinting

One glanceable line in Drive view: "next thing + distance" ("Storm cell · 8 mi") — third surface of the same fused route-ahead pipeline that feeds progress rail (spatial) + advisory bar (scrolling). Hazards ON the route line = tint existing polyline segments by severity, matching rail colors — one mental model, many views. Cautions: must yield to active turn guidance (same eyeline = crash risk); tint the existing polyline, no new overlay layers. Natural fit beside the sliding-window bubble idea.

### 2026-11-06 - P1: CarPlay companion got the real advisory stack + hazard echo

Bill's 566 drive notes: companion page now embeds the same expanded advisory content as the map view (local Now/24h/7d + route weather/road hazards) via a shared `useAdvisoryExpandedModel` + `AdvisoryExpandedSections` extracted from StormAdvisoryBar — one derivation, two surfaces, they cannot disagree. CarPlay hazard popup now drops its announced titles into UserDefaults; the phone polls (`carPlayHazardAlert`, read-and-clear) and highlights exactly those hazards on the companion page. CarPlay TBT was re-sliding identical panels because `VisualInstruction` equality churns on fields the driver never sees — upcomingManeuvers now only reassigns on a content signature (texts + maneuver type + step/leg). ETA card pinned `tripEstimateStyle = .dark` (light style was the white-panel regression). Also: planning alternates now reject "exit here, rejoin one exit later" wobbles (`routeIsBriefDivergenceOnly` — leaves corridor >800 m but rejoins within ~6 km along Main); trail-preference could previously promote one to the darker primary line.

### 2026-11-07 - P1: jumpTo never had the yard-line offset — the drone was the leak

Bill's iPad landscape report ("puck in the middle in Dr, lower but not the 30-yard like the phone") traced to `writeDronePose` in mapViewFly: every view transition (GO→Dr, Dr↔Mp↔Rt) writes poses with `jumpTo`, and Mapbox's `jumpTo` silently ignores `offset` — only `easeTo`/`flyTo` honor it (verified in mapbox-gl 3.24 source: Camera.jumpTo handles zoom/center/bearing/pitch/padding, no offset). So the whole fly-in landed with the puck at padded-center; parked at GO the follow loop's parked-hold kept it there indefinitely, and only real movement snapped it to the yard line via the easeTo path. Fix: after each drone jumpTo, re-solve the center in ground space (`centerPuttingPuckAtScreenPoint` + shared `resolveYardLineCameraCenter` sane-or-clamp) so the pose's offset is honored every frame — same solver the hard writer already used. Also pinned the iPad-landscape anchor to a true ~70% viewport fraction: the shared offset formula's 140px cap was tuned for ~390px phone landscape and left the puck ~3% high on an 834px iPad. Lesson for P1: any camera write that isn't easeTo/flyTo must re-derive `offset` itself — audit setCenter/jumpTo/setTransform callers the same way we audited padding. PiP RT map now shares the main map's day/night basemap (`currentMapStyle` + phase tick + setStyle + layer re-apply + night readability) — second GL context had been stuck on streets-v12 forever.

### 2026-11-08 - P1: Mp puck vibration was a degree-space gate, not a writer fight

Bill reported the puck vibrating in Mp after the iPad panel-padding change. The Dr-only health watchdog was innocent (it only runs in drive view); the real suspect was the topdown RAF branch gating camera writes on a raw lng/lat delta (CAM_NOOP_LNGLAT_DELTA ~0.11 m) between map.getCenter() and the puck. With asymmetric panel padding the settled residual can hover right at that threshold, so camMoved flickered true/false every frame and easeTo(duration:0) fired on alternating ticks � sub-pixel camera oscillation = visible vibration. Fix: gate on puck-to-anchor **pixel** drift via readDrivePuckAnchorDrift (project puck, compare to padded-center anchor, write only above ~2 px). Same lesson as the padding double-count notes: compare in the space the user sees (screen px), not degrees � degree deltas are zoom- and padding-dependent, pixel drift is not. If vibration reports continue, next suspect is the smoothed puck marker itself, not the camera.

### 2026-11-08 - P1: turn-anticipation lean can hit ~81� and reads as a hard flip

Bill's build-573 drive dumps: puck steady after the pixel-drift gate, off-route reroute worked, but he caught one hard camera flip early in a turn. Diagnostics show Lean: max 81� (drive 2) � that is resolveTurnCameraBearing aiming the camera at routeAheadBearingDeg whenever the chord is within NATIVE_CAM_ANTICIPATE_MAX_DELTA_DEG (125�). Two triggers make it snap: (1) right after Rt?Dr or a route switch, the ahead sample can already be bent around the corner while the car heading is still straight; (2) off-route ? alternate swap hands the camera a new route''s ahead bearing ~80� off the old one. alignDriveBearingDeg eases the sweep but an ~80� target still moves fast. Ideas if it bothers him: cap the committed lean (e.g. 45�60�) and let the car''s own heading carry the rest of the turn, or slew-limit the target bearing change per second so a route switch can''t whip the camera. Not urgent � one occurrence, self-recovered.

### 2026-11-08 - P1: phone landscape adopts the iPad command panel (minus PiP)

Bill: "copy the ipad layout minus the PIP" for iPhone landscape. The panel MQ in 21-tablet.css widened to `(orientation: landscape) and (max-height: 500px)` — navSidePanelInset() is pure DOM measurement so Mp/Dr camera padding, route-fit insets, and topdown panel padding all adapt with zero JS gates. LandscapeInfoPip keeps TABLET_LANDSCAPE_MQ so phones never mount the second GL context; TabletLandscapePanelPortal got a wider PANEL_LANDSCAPE_MQ so TBT still lands in the panel slot. Phone-only tweaks: panel ~40vw, rail spans both grid rows + foot-inset hook drops strip-length (100cqh = full height per Bill's "top to bottom"), miles-left moves to the outer edge beside the controls. Watch on device: 390px-tall panels are tight — plan-stack wraps (flex-wrap) and overflow-y:auto scrolls; if the planning stack feels cramped, next lever is hiding the search row behind a tap. Also fixed (both iPad + phone panel): planning about-row buttons now wrap instead of the route-cycle label painting over its ETA when the Briefing pill squeezes the row, and chrome-wrap gets margin-top:auto so the setup pins to panel bottom instead of floating at top.

### 2026-11-08 - P1: night basemap now flips mid-trip; multi-stop trips uncapped to 4

Bill: "the map will not flip to the night map while a route is active." Root cause was `allowBasemapStyleReload` gating `setStyle` on `!navigationStarted` — a conservative hold from the dead-zone work (style swap "wipes cached tiles and blocks follow-cam"). In practice day/night styles share Mapbox's vector tiles so the reload is fast, and every layer family already re-applies on style.load/styledata (routes, traffic, radar, night readability). Now only `holdLastGoodMap`/offline blocks the swap — dead zones still freeze the basemap because new-style tiles can't download there. If a mid-drive flip ever blanks too long on weak-but-not-held signal, next lever is deferring the swap to the next stop/light via a pending-phase flag.

Bill also asked about the "add a stop" limit — it was still `MAX_VIA_STOPS = 1` with single-stop-only UI (`RouteStopsBar` rendered `viaStops[0]`, add button hid after one stop, voice/spoken-stop flows replaced the array). The whole nav pipeline was already array-based (activeViaIndex advance on arrival, remainingViaStops on reroute, hazard-bypass pull stacks, native guidance coords). Raised to 4 — covers pickup → drop → rest/fuel → final; Mapbox Directions allows 25 coords so headroom is huge if truck drivers need more (one-line constant). RouteStopsBar now lists all stops with numbered badges, spoken-stop flows append instead of replace, and hitting the cap shows a tap hint instead of silently dropping the pick.

### 2026-11-08 - P2 research: free DOT/511 coverage is ~38 states + DC, not a paid aggregator yet

Bill asked how many states hook up free. Answer: nearly all have SOME feed, but license tiers differ. Tier 1 (clean for commercial use): WZDx work-zone feeds are CC0 across 35 states (AZ CA CO DE FL HI IA ID IL IN KS KY LA MA MD ME MI MN MO MS NC ND NH NJ NY OH OK OR PA SD TX VA VT WA WI — registry: data.transportation.gov/resource/69qe-yiui), plus NM (CC0), NE+TN (CARS public domain), DC (CC BY), and deeper incident layers on KY/IA/CA/MD/OR/PA. NOT Tier 1: AL AK AR GA NV RI UT WV WY (free key, no license) and CT (CTroads forbids commercial; CARS events are public-domain — verify which feed). AR bans ads with its data — conflicts with Basic tier. Caveat: WZDx = work zones/lane closures only, no incidents; clean incident coverage is thinner (NM KY IA CA CARS-states NYC). Path if built: Cloudflare Worker normalizer (same pattern as rainviewer-tiles proxy) polling WZDx registry + clean 511 feeds -> one endpoint for the app. Aggregator (Road511/Roadscore/Argus) still the zero-effort path for all 50.

### 2026-11-08 - P1: state DOT/WZDx feed v1 built (Plus, work zones first)

Bill picked construction over incidents ("construction is the bigger traffic effector"). Built the WZDx-first slice from the P2 research: new `cloudflare/dot-feeds` Worker polls the USDOT registry (~30 no-key feeds), normalizes work zones/closures to one schema, edge-caches the merged snapshot ~4 min in Cache API (no KV/cron — self-heals per PoP), serves `/events?bbox=` so the app pulls only the route corridor. App side: `services/dotRoadEvents.ts` + `nav/dotImpacts.ts` convert events into `RouteImpact[]` (new source `dot511`) inside `useRouteAheadDerivations` — so rail bands, hazard card, advisory, map highlights, and bypass logic all pick them up free. Corridor match = 260 m half-width via `closestPointOnPolyline`; severity bumps for all-lanes-closed and truck size/weight limits (restrictionsText). Plus-gated; corridor-matched impacts also become non-interactive map dots (`.map-dot-event`, amber construction / red closure / orange incident). Deploy needs `wrangler login` + `wrangler deploy`, then `VITE_DOT_FEED_URL=https://stormpath-dot-feeds.<subdomain>.workers.dev` in build env. v2 backlog: keyed feeds (CO/OR/OH/NPS/WI/ID), clean-incident adapters (NM KY IA CA CARS-states), dedupe across overlapping feeds, scheduled-vs-active UX if noise shows.

### 2026-11-08 - P1: DOT dedup + interactive PiP + bypass offers + frosted iPad panel

Bill's pre-Go report: same construction showed as red Mapbox bands AND orange WZDx dots, with 3-4 fragmented entries (332/334/335 mi, exit 77-82 wording). Root cause: WZDx splits EB/WB into separate features, multiple state/county feeds overlap, and Mapbox incidents report the same zone independently. Fixes shipped together: (1) `dotImpacts` now clusters matches on same road-key + along-route gap/span (CLUSTER_GAP_M/CLUSTER_MAX_SPAN_M) merging direction text into one detail; `reconcileDotMapboxImpacts` suppresses Mapbox incident twins within ~1.5 mi and folds their text into the DOT row. (2) RouteOverviewPip is now interactive (pan/pinch zoom, rotate stays off) with a viewLockedRef that suspends the 2 s route re-fit on user input until Reset; new focusHazard prop easeTo's a picked timeline/advisory hazard and drops a .pip-hazard-dot marker; alternateGeometry prop draws a dashed green bypass line (currently null — compare-state doesn't carry geometry yet). Hazard select wires RouteProgressGlancePanel.onHazardSelect -> App pipFocusHazard -> LandscapeInfoPip -> PiP. (3) DOT serious work zones now get driverAction rerouteAvailable (closures rerouteRecommended) so pickTrafficBypassAnchorImpact's existing construction/closure path can offer bypasses; avoid stays rerouteRecommended. (4) iPad landscape panel is frosted (rgba + backdrop-filter blur, solid fallback) and hazard/PiP sections wrap in CollapsiblePanelSection — collapse to an outer-edge tab (mirrored for hand-left), state persists in localStorage; TBT slot + dock never collapse. Open threads: bypass compare flow needs alternate route geometry plumbed to pipAlternateGeometry; WZDx date-range normalization showed a "(Dec 31 - Dec 30)" oddity worth checking; cross-source merge window/category rules may need tuning after real-drive feedback.

### 2026-11-08 - P2: rest/sleep-stop planner — polite nudge + hotel links up the road

Bill's framing (not HOS enforcement): on long trips, politely ask ~8 driving-hours in whether the driver wants to plan a rest stop, then offer hotel suggestions a couple hours up the road with links out to booking sites (check availability / make reservation). Why it could work: we already have route geometry + ETA (point-in-time lookup along the route is cheap), the via-stop system now holds up to 4 stops (a rest stop can become a real leg), destination search can bias to a corridor point, and tripLog already distinguishes stop types (rest/inspection) for the chain record. Shape ideas: (a) trigger on elapsed *driving* time, not trip time — needs an off-duty assumption or driver toggle; (b) POI sources for rest areas/truck stops — Mapbox categories first, OSM rest_area later; (c) hotels = deep links to Google Hotels / Booking / Expedia search URLs pre-filled with location+date — no API keys, no affiliate deals needed for v1; (d) optional: if driver accepts, auto-add the chosen stop as a via so re-routing happens around it. HOS context for truck drivers: FMCSA 11-hr driving / 30-min break after 8 hrs / 10-hr reset — a "suggested, not required" framing keeps it a nudge, not legal advice. Open questions parked here: where the nudge surfaces (hazard card vs advisory bar vs a dedicated banner), whether hotel links need Plus gating, and whether we track planned-vs-actual rest time in tripLog.
