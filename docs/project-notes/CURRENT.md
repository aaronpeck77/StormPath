# StormPath — current handoff

Updated: 2026-11-05, Devin Desktop (local session; 564 drive feedback). Latest section first; it supersedes older build/next-step lines. This file update is LOCAL ONLY; not pushed.

## Latest — 2026-11-05: 564 drive-test batch + hard-lock Stage 1 + companion v2 (local, NOT pushed)

Bill drove build 564 all day and reported. His headline principle, now policy: **a route he accepts must never change silently** — deviate → guide back onto it; a better option only via a prompt he approves. His other asks answered below. All changes local, uncommitted→committed locally only; NOT pushed.

**Quick batch (done):**
- Speed limits hidden everywhere pending a better data source: `SPEED_LIMIT_DISPLAY_ENABLED = false` gates CarPlay sign, companion chip, and phone Lim readout (`nav/postedSpeed.ts`). Reversible one-line flip.
- Companion ETA now formats `h:mm` via `formatMinutesAsHoursMinutes` like the rest of the app.
- CarPlay hazard popup deduped (Swift): at most once per distinct hazard title per trip + 20-min cooldown — was re-firing on every 15 s snapshot.
- "Weather & hazards" return button moved above the bottom toolbar so it stops covering buttons during map peek.
- CarPlay route line repositioned below `poi-level` layer (was only below `road-label`) so road signs/POI icons stay visible.

**Hard-lock Stage 1 (done, needs drive test):**
- `nativeRouteChangedShouldForce` no longer force-adopts mid-trip Core geometry when the driver picked an alternate — disagreement now falls through to DIY off-route machinery, which has rejoin-to-corridor logic ("push him back to that path" per Bill). Session-start refinement still protected.
- Diagnostics: `lockPick` now records locked route preference+label at Go (`noteDriveDiagRoutePick`, wired in App.tsx) so next dump shows WHICH chip was locked — `lock fastest` label only ever meant preferBackroads.
- Watch item: `MANUAL_OFF_ROUTE_CHOICES_ENABLED = false` means DIY auto-reroutes silently today — if drive test still shows flips, the next step is gating DIY's silent replan behind the same approval rule.
- Bill's via-stop note: adding a stop to shape a route then having to skip it — via-stop skip semantics still need a UX pass (pending).

**Companion v2 (done):**
- `CarPlayCompanionView` now embeds the REAL components, not summaries: `RouteProgressStrip layout="fullBleed"` (horizontal route line + turn ticks + storm bands + radar slice) and `RouteProgressGlancePanel` (wind/radar/rain/temp weather graph + hazard timeline), fed by the same props `AppProgressRail` uses. Hazard/forecast sections kept below.
- Verified: `tsc --noEmit` clean, full deterministic suite 1,340 tests green.

**Investigated, no code:**
- CarPlay recents tray is Apple-owned UI — we can't pin our icon. The "reverts to Apple Maps icon" symptom is worth one look at scene re-presentation but expectations are low.
- ETA ~3 min CarPlay-vs-phone gap: two independent estimators; should converge once routes provably match — re-check after hard-lock drive test before touching ETA math.
- ETA math answer for Bill: Directions API uses Mapbox's per-road-class speed profiles + live traffic, NOT posted speed limits — which is why sign data and ETA can disagree.

## Earlier — 2026-11-05: CarPlay companion view (`af159f4`, local commit, NOT pushed)

Bill proposed the phone stop mirroring nav while CarPlay drives — implemented:

- `carPlayConnected()` added to stormpath-car-session plugin (Swift checks `connectedScenes` for `CPTemplateApplicationScene`; JS dist stub returns false on web). JS polls every 2s via `useCarPlayActive`.
- New `CarPlayCompanionView` (`src/ui/CarPlayCompanionView.tsx`): destination, ETA min + distance left + arrive-by clock, advisory line, progress bar, sourced speed-limit chip, then the SAME `buildCarConditions` sections the car sees (Route hazards / Route forecast / Local forecast) — phone and car can no longer disagree because they render one snapshot.
- App.tsx: when `carPlayActive && navigationStarted` the map stage is replaced by the companion; "Map" button peeks at the map, floating "Weather & hazards" button returns. Auto-reverts when CarPlay disconnects or nav ends.
- Verified: tsc clean, 1,340 tests pass. Swift change needs plugin check on next push. NOT pushed — awaits Bill's go-ahead (and ideally after he drive-tests 563).

Also this session: Bill's Apple org verification submitted (stormpath.us bought via Cloudflare Registrar; domain TXT verified; org in review, ~5 days). stormpath.app confirmed NOT ours (someone else's civic site) — docs reference to tiles.stormpath.app is stale, workers were never deployed anyway.

## Earlier — 2026-11-05: Bill's 562 drive report and fixes (`402ca78`, iOS build 563 uploaded)

Bill drove 562 on CarPlay and reported. Fixed and pushed in `402ca78`:

Bill drove 562 on CarPlay and reported. Fixed and pushed in `402ca78`:

- **Route contradiction (the big one):** Core free-routed between corridor shapes spaced 90 km apart, so its route — which CarPlay draws — could be a completely different (fastest) line than the phone's locked alternate. `nativeGuidanceCoords` now caps at 24 coords (Directions limit is 25) with ~2.5 mi adaptive spacing (`SHAPE_STEP_M` 90 km → 4 km target). Each shape already carried 80 m `coordinateAccuracy` pinning. Combined with yesterday's alternate-preference reroute fix, CarPlay and the phone should finally draw the same line.
- **Speed limit stuck:** sign now prefers route-step Directions `maxspeed` (moves with the road at each segment) over the horizon value; horizon only as fallback. Still sourced-only, never the class estimate.
- **Hazard popup false positive:** "Route hazards" section no longer includes `crossesRoute: false` "Nearby" items — the popup fired on a nearby warning while the phone showed no route hazards.
- **ETA box white/black text:** pure `.black` fails CarPlay's `guidanceBackgroundColor` contrast check and silently falls back to default white. Now near-black navy `(0.03, 0.10, 0.15)` — visually black, should pass the check (same family as the teal that worked).
- **Night map unreadable:** dark-v11 → `navigation-night-v1` (lit road casing for night driving).
- **Puck:** nose cone trimmed (18×26) so it no longer protrudes under the dome.
- Verified: `tsc --noEmit` clean, targeted vitest green. Swift changes need check 17 + archive.

Open from his notes: phone→CarPlay control surface question answered in chat (puck color already syncs; candidates: route color, day/night override, radar default). ETA divergence vs phone is expected to shrink once routes align; keep watching "ETA: jump" diag lines.

## Earlier — 2026-11-03: Bill's 559 drive report and local fixes (uncommitted, unpushed)

Bill drove 559 (shop → job 1 → job 2) on CarPlay and reported. Fixes below were pushed in `fba8902` (build 560), then `0ed1901`+`aa01f47` (build 561) after Swift check 14 caught a `CPMapTemplate.present` `completion:` arg this SDK lacks — fixed by dropping it. 560's IPA may still upload with the compile failure (check its status); **561 is the build to drive.**

**Fixed in code this session:**

- Puck: Bill says 559's puck is way too big and wants the original small one — but still 3D, not a flat disc. Now a 22pt dome: white ring, phone-color fill, small top-left sheen (gradient reaches the color at ~30% radius instead of covering half the dome, which is why orange never read on the car screen), small heading cone, scale 1.0. Replaces the 36pt dome at 1.1. Same `stormpath.car.puckColor` pipeline — color still follows the phone's Info choice within ~15 s.
- Destination marker: red dot on the car screen like the phone app — `map.waypointColor = .systemRed` (was the SDK default white). Applies to remaining waypoint dots incl. via stops; completed waypoints stay hidden by the SDK.
- Chrome: `guidanceBackgroundColor` → black (his ask for the arrival/minutes/miles area). `automaticallyHidesNavigationBar` + `hidesButtonsWithNavigationBar` → true, giving Apple's own hide-until-tap behavior for the buttons and top bar instead of a custom layout.
- Radar: Drive view no longer shows the radar button or auto-enables radar; RT view (guiding) keeps it. "Radar unavailable" no longer latches — tile-source errors drop frames and the 5-min refresh reinstalls, manifest failures keep the last good frames animating, and an unpublished tile base reports "Radar needs phone" instead of a dead "unavailable." Root cause of his one-shot "unavailable" still unproven (tile URL shape matches the phone's working proxy path).
- Hazard popup: when the phone snapshot lists live route hazards during an active nav session, CarPlay shows a `CPNavigationAlert` — "Hazards on your route / N flagged ahead — check your phone for details," once per distinct hazard set (his "CarPlay can't display this → point at the phone" idea).
- Advisory wording: "Clear on the map now — rain likely near X" read as a contradiction on the advisory row; now "Radar clear for now — rain likely near X."
- Alternate-route override: on his first drive he picked the alternate and a missed turn put him on the main path. Cause found: mid-trip Core `routeChanged` is force-adopted whenever the driver is off the locked corridor, and Core's reroute is always its fastest line. `nativeRouteChangedShouldForce` now accepts `driverPrefersAlternate`; with an alternate locked, a mid-trip emit goes through the agreement check, fails, and the trip abandons to DIY — whose replan (`assignOffRouteReplanSlots`) already honors the alternate preference. Fastest-lock behavior unchanged; first session emit unchanged. `useNativeNavSession` gained an optional `routingPreferenceRef` param; App.tsx passes it. Two new guard tests.

**Answered, not changed:**

- Speed limit on the car screen: shipped in 561 (`0ed1901`+`aa01f47`). No Apple speed-limit API exists for third-party nav apps — we draw our own US-style placard (`SpeedLimitSignView`, bottom-left of the car map). Bill's requirement: never show an estimate on CarPlay. The bridge publishes `speedLimitMph` ONLY when `postedSpeedForDisplay` is sourced (electronic horizon or Mapbox `maxspeed`, `classEstimate === false`); sign stays hidden otherwise. Files: `carSessionPublish.ts` + `useCarSessionPublish.ts` + `App.tsx` (publish), `StormpathCarSessionPlugin.swift` (defaults key), `StormPathCarPlay.swift` (sign view + snapshot refresh).
- StormPath graphics on CarPlay (graph, progress rail with radar slice): Apple only allows template UI + our Mapbox map. Text lists can carry small images/icons; the interactive rail cannot be reproduced. The colored route-casing severity idea is parked in BRAIN_THINKING.
- Dock icon: StormPath drops from the CarPlay recents tray when another app takes the screen — partly Apple's recents behavior; "came back as the Apple Maps icon" needs watching, no known fix in our templates. StormPath appearing as a nav option only during a trip is normal for template apps.
- Plus vs Basic for CarPlay: recommendation given to Bill (CarPlay nav itself Basic-OK; weather/hazard content is already Plus-gated inside Conditions).

**Verification:** `tsc --noEmit` clean; targeted vitest 44/44 pass (guard, advisory wording, car publish). No Swift compiler on Windows — `StormPathCarPlay.swift` changes are uncompiled; run the Swift plugin check on the Intel runner before the next TestFlight.

**Open for the next drive:** puck color/size on car, auto-hiding chrome feel, radar in RT view, hazard popup timing, black ETA area, whether the alternate keeps its lock through a missed turn, and the recents-tray icon. Three 559 diagnostics also showed: drive 1 3 off-route/318s longest; drive 2 13 off-route/45s; drive 3 ETA "jump 5min at 5+mi (line)" — keep watching ETA jump reports.

## Earlier — 2026-11-02 authorized TestFlight push and Intel runner change

- Bill authorized pushing the CarPlay pass for TestFlight. Pushed `b673986` (weather/hazard/visual pass), then `79394cc` (explicit `self` references required in three nested Swift callbacks; initial Swift check 11 caught those compile errors).
- Build 557 was superseded. Build 558 and Swift check 12 subsequently failed before any build steps: GitHub reported no hosted runner acquired and macOS arm64 capacity constraints. Retrying once each did not establish a native result. These capacity failures were not new Swift/signing failures.
- Bill approved an alternative Mac pool. Pushed `b105971`: only two `runs-on` scalars changed from `macos-latest` to `macos-26-intel` in `ios-build.yml` and `swift-check.yml`. Plain `macos-26` would still select Apple Silicon. Intel runner image has both Xcode 26.3 (the archive workflow's first choice) and default 26.6 (Swift check); generic iOS destination still builds arm64 for iPhone. No signing/security/test settings changed and no paid larger runner selected.
- **TestFlight 559 / version 4.22.1 succeeded on Intel**: archive, IPA export, Transporter upload, and Confirm Apple listed the build all passed. Swift plugin check **13 passed** on Intel. GitHub web tests **422 passed**. Run: `https://github.com/aaronpeck77/StormPath/actions/runs/41497309356`. Apple listing does not itself prove tester availability or actual in-car behavior; Bill still needs to install and test.
- Notes remain local/uncommitted; preserve all pre-existing edits. App Store 554 unchanged. Stop feature work until Bill tests the new build, including a real drive. Do not push again without fresh approval except necessary fixes for this authorized build.

## Earlier — local CarPlay weather pass before the authorized push

- Bill supplied his first 556 CarPlay drive and a photo: smooth route motion, liked the black casing; route too thick over road information, small flat blue puck despite orange phone setting, red turn card, only the next turn. Tapping reveals/hides the top bar. StormPath lost the dock slot after switching to an audiobook. His faulty phone port caused cable disconnects; do not assume those are software failures.
- 556 dump: 62.5 min, 134 phone-side Core samples (0.04/s), zero camera freezes, 18 write failures (max streak 1), six reclaims, 12 off-route episodes totaling 98s (longest 44s), one doubled-back report, live ETA jump 3 min at 5+ mi. Most use was on CarPlay. Do not interpret sparse phone/web counters as proof the smooth native car map failed. Dock/session continuity and ETA/speed-limit concerns remain open. Two 554 dumps were repeats; final 556 paste was incomplete.
- Bill authorized the visual polish and asked to bring StormPath weather/hazards onto CarPlay, at minimum RT overview with radar. Implemented locally on `master` at `1e078a3`; no version bump, commit, push, workflow dispatch, deployment, or App Store change.
- `StormPathCarPlay.swift`: RT/Drive navigation-bar switch using the car navigation camera; RT enables observed radar, Drive disables it. Separate radar toggle can also show radar while following. Native RainViewer manifest refresh every five minutes, up to four observed frames from the last 30 minutes, 1.5s loop, max zoom 7 with overzoom, shared existing tile-proxy URL from build configuration. Raster sources below route/labels, attribution, timestamp/loading/unavailable/stale states, tile-error handling, cancellation and cleanup. No Cloudflare deploy or new tile endpoint. Radar is current/observed map weather, NOT arrival-time forecast or guaranteed hazard avoidance.
- Visual polish: dark blue guidance-card background instead of default red; narrower route plus dark casing and below-road-label placement when available; larger shaded dome/course nose using the phone puck-color choice (still drawn 2D, not a new 3D model); supplies the following visual maneuver where available (Apple controls how many appear). Pan/zoom/recenter retained. Navigation bar stays visible so RT/weather access does not vanish.
- Conditions native menu: existing route advisory, shared route hazard timeline (including road alerts and timing/relevance), route forecast milestones (temp/precip/gusts), local current/hourly forecasts. Native list/detail templates with pagination, not a copied phone screen. Exact graph, progress rail, warning polygons, custom left/right layout, current speed and posted-limit display are NOT added. Do not claim Apple absolutely forbids every future graph presentation; the verified path here uses native text templates.
- `useCarSessionPublish` and `carSessionPublish`: bounded-frequency (15s) snapshot publication through the existing car-session bridge; no routing ownership changes and no new App.tsx hook cluster (existing publishing hook extended). Native radar works independently of web timers. Forecast/hazard data are phone snapshots, NOT a new native live forecast provider; timestamps and stale/offline wording matter while the WebView is suspended. Plus gates route/local forecast details; expired/passed hazards and old local forecasts are filtered; empty data is not a clear-road claim. New bridge/type fields preserve map configuration and local forecasts while idle without starting a trip.
- Verification: new bridge/projection tests started failing, now eight pass. Full deterministic suite: 217 files / 1,338 tests passed with `src/weatherAlerts/__tests__/nwsUsProvider.integration.test.ts` excluded. `npm run build:testflight` and `npm run build` passed, including TypeScript; existing large Mapbox bundle warning only. `git diff --check` passed. Windows has no Swift compiler/Xcode: native code was checked against pinned SDK sources but has NOT been compiled or tested in a car. Web tests do not establish Swift correctness.
- Next gate: with Bill's authorization, run the macOS Swift plugin check before a new phone build; then test RT/Drive fit, radar loading/animation/age/attribution/offline and recovery, route visibility beneath radar, conditions/details/pagination/staleness, puck choice, two turns, Stop, locked phone, audiobook switching, cable reconnect, and both day/night styles. Keep App Store 554 unchanged. Do not commit/push even notes until Bill asks. Both notes files had pre-existing uncommitted edits; preserve them.

## Earlier — 2026-11-01 afternoon: builds 555 and 556, CarPlay

- GitHub `master` tip is `1e078a3`. Both Forge checkouts (`C:\Users\ACCESS\Documents\TestDrive\StormPath` and `C:\My Apps\StormPath - v3`) were fast-forwarded to it; their uncommitted notes files were kept.
- **TestFlight 555** = `634524c` (Bend gestures + open-road access, described below). Bill asked to push it. The "NOT shipped" note in the Bend section below is superseded.
- **TestFlight 556, version 4.22.1** = `8ab0b3b` CarPlay + `1e078a3` version bump. Uploaded; Apple listed it. Swift plugin check passed. Not yet tested on a phone or in a car.
- Apple assigned the CarPlay entitlement on 2026-11-01 (Navigation, `com.apple.developer.carplay-maps`). Bill ticked CarPlay on the App ID. The new App Store profile (expires 2027-04-24, includes carplay-maps and weatherkit) is in the GitHub secret `APPLE_PROVISIONING_PROFILE`. Case-ID 22965569 was the request; Apple may still want car-screen screenshots of a turn.
- CarPlay design (see `docs/CARPLAY.md`): car screen = Mapbox map following the puck, next turn (distance, street, arrow), trip ETA, pan, zoom, recenter. Fed from the phone's native Core session. Trip still starts on the phone. Car's own navigation cancelling ours stops the phone trip. Idle exit skipped while CarPlay is connected. Code: `web/plugins/stormpath-mapbox-navigation/ios/.../StormPathCarPlay.swift`; scene manifest in `web/ios/App/App/Info.plist`; phone scene in `AppDelegate.swift`; `App/StormPath.entitlements` set as `CODE_SIGN_ENTITLEMENTS`.
- Biggest risk in 556: the phone app now launches through a scene manifest (needed for CarPlay). Check launch, map, search, Go/Drive, Bend, ads, Plus screen, and a locked-screen trip.
- 556 test list: phone app as usual; lock screen mid-trip; CarPlay with no trip (icon + map); CarPlay with a trip (turn card, ETA, voice through car); pan/zoom/recenter; arrive or Stop clears the car card; unplug mid-trip keeps the phone trip. Screenshot a car-screen turn for Apple.
- Version bump left `web/netlify/functions/grok-dock.ts` User-Agent at 4.21.4 on purpose; changing a function triggers a Netlify deploy.
- Next: Bill drives 556 and tests CarPlay, then brings dumps/screenshots. Fix only what those show. Do not push again without his OK.

## Earlier 2026-11-01 handoff

- Bill is moving between Devin, Cursor, and Grok and wants short sessions using this shared file for continuity.
- Current ACCESS checkout: `C:\Users\ACCESS\Documents\TestDrive\StormPath`, branch `master`. Forge is a separate checkout; local-only changes here are not visible there or to GitHub-only agents.
- Fetched GitHub and fast-forwarded from `5ed6406` to `2ce8f23`. GitHub build **554** and its web-test workflow succeeded. Bill says he submitted **554 to App Store review**; Apple review status was not independently checked. Do not replace or resubmit it without permission.
- Cursor's pushed changes: `4895db2` yearly Plus copy ($49.99, two months included; monthly $4.99 and monthly-only eligible trial unchanged), then `2ce8f23` manual mid-drive Bend with two via-point pulls, Undo and Cancel.

### Morning drives on 554

Bill supplied two diagnostics: 11.9 min / 242 Core samples / GPS puck / five off-route episodes totaling 69s (longest 61s); 4.8 min / 30 Core samples / GPS puck / two episodes totaling 10s (longest 7s). Both had steady ETA, zero camera freezes and zero reclaims. Bill explains home has little/no cellular coverage: planning on Wi-Fi keeps the route active and steady until coverage returns. Do not infer that the off-route counters alone prove a navigation failure. Camera occasionally snaps; frequency unknown. He will keep testing 554. Speed-limit accuracy, occasional snapping/Core recovery, and repeated earlier ETA jumps remain open; no fixes to those were made this session.

### Authorized local Bend work — completed, NOT shipped

Bill agreed Bend should not clutter in-town driving, and reported 554's Bend opened overview/Undo/Cancel but dragging only performed normal map gestures. Implemented local commit **`634524c` — Make Bend gestures reliable and reserve access for open-road travel**. It is one commit ahead of GitHub as last checked. No push, deployment, or new TestFlight was started.

- Replaced map-level Bend gesture listeners with capture-phase DOM pointer handling and pointer capture. Pull must START ON the route line. A marker follows the finger; release beyond 18px requests a bend. Suppress competing legacy touch/mouse gestures and click-through; cancel interrupted/multi-finger gestures and clean listeners up. Automated regression passed; actual iPhone behavior is still unverified. Do not claim the reported phone bug is conclusively resolved yet.
- Removed the entry button from the normal Drive toolbar by no longer supplying its entry callback. Undo/Cancel remain while editing.
- Manual entry: **Route Info → Route options → Bend route**, only during an active trip on a qualifying stretch. Five continuous miles of interstate, or a named US/state/county/highway road with a known Directions speed sample >=50 mph. Uses existing turn-step road names/refs and speed samples, not total-trip length, a new API, or city boundaries. Unknown roads stay hidden. This conservative proxy can miss valid rural roads and does not prove a road is outside town.
- Shared timeline promotes a matching serious/avoid hazard in the Drive hazard ticker only when explicitly crossing the route, current/not muted/coarse/stale/developing-later, >1 mile ahead and within the same qualifying open-road stretch. Online only; defer within 1 mile of the next maneuver or when maneuver distance is unknown. Ticker's existing Plus/Drive/off-route rules still apply.
- **Not now** dismisses the Bend suggestion for that hazard ID/severity during this trip; severity changes can re-offer. Manual access remains available on qualifying roads with no detected hazard.
- Offline entry/calculation is blocked with an explanation; preserve the current route. Busy guard prevents overlapping pulls; calculation failure restores previous via stops/index. Existing two-bend cap, Undo and Cancel retained.
- A bend is a must-visit point, NOT guaranteed hazard avoidance. UI avoids claiming otherwise. Manual use is for stopped drivers or passengers. No automatic jam bypass and no change to `TRAFFIC_BYPASS_ENABLED`.
- Availability/session logic stays in `nav/hazardBypass.ts` and `nav/useHazardBypass.ts`; App.tsx only wires existing data and callbacks. UI changes: `ui/hazardBypassDrag.ts`, `ui/AppProgressRail.tsx`, `ui/DriveHazardTicker.tsx`, `App.css`, plus tests.

### Verification / next action

- **216 files / 1,330 tests passed**: `npm test -- --exclude src/weatherAlerts/__tests__/nwsUsProvider.integration.test.ts --testTimeout 20000` from `web/`. Live NWS integration excluded.
- `npm run build:testflight` passed (TypeScript and flavor assertion); `npm run build` passed. Existing large Mapbox bundle warning only. `git diff --check` passed before commit.
- Local `docs/BRAIN_THINKING.md` contains pre-existing uncommitted changes plus a short 2026-11-01 Bend note. Do not commit or push it without Bill's request.
- Bill asked to update this file before starting a new session. Read this section first next time. Do not stack unrelated features, push, trigger TestFlight, deploy Netlify/Cloudflare, or alter App Store review without authorization. Next meaningful check is iPhone Bend interaction and the availability rules in a future authorized test build; 554 does NOT contain `634524c`.

---

## Earlier handoff history (historical build/next-step statements below may be superseded)

Read this at the start of a new chat when Bill says to continue or before changing the app. Update it at the end of a session with what changed and what is still open. Keep it facts and decisions. Do not paste this file back into the chat. Do not put tokens, the EIN, the D-U-N-S number, or the SSN in here.

Bill asked on 2026-10-31 to put this file on GitHub so Devin and the next Forge chat can read it. Devin only sees what is pushed.

## Why this file exists

Long chats resend the whole thread on every message, so credits run out on short questions. Bill will start new chats often and point them here. Cursor on Forge and Devin on GitHub both hit usage limits. Work bounces between them. GitHub is the shared code. This file is the shared memory.

## Where the code is

- Repo: `https://github.com/aaronpeck77/StormPath.git`
- **Working branch is `master`.** Bill said on 2026-10-28 night that master is the branch we move forward on, and the latest work is there. Stay on `master`. Do not check out `native/drive`. Do not start a feature branch unless he asks.
- Forge checkout: `C:\My Apps\StormPath - v3`, branch `master`. The 2026-10-28 tip was `5ed6406`. The next commit on `master` is the 2026-10-31 yearly price copy Bill asked to push.
- GitHub `master` before that price commit: `5ed6406` (2026-10-28, author Devin), “Keep complete landscape turn instructions readable.”
- `native/drive` at `9b24d1c` is an ancestor of that `master` (0 ahead, 49 behind). Master already has the native/drive work plus Devin’s Oct 23–28 kit. Leave `native/drive` where it is.
- Local dirty files still not in git, do not commit unless he asks: `.gitignore`, `docs/BRAIN.md`, `docs/BRAIN_THINKING.md`, `AGENTS.md`. This notes folder was pushed on 2026-10-31 with the yearly price copy.
- A push to `master` fires TestFlight. Do not push, and do not ship App Store or TestFlight, unless Bill asks. Do not deploy Netlify or the Cloudflare rainviewer worker unless he asks.

## What Bill said on 2026-10-28

He likes what Devin did. Expect to bounce the app between Devin and Cursor because both platforms cut usage and he runs out of credit. He wants new chats to read this folder instead of growing one thread.

Night of 2026-10-28: master is the working branch. This PC had still been on `native/drive`. He asked to switch to master before changing anything, update these notes, and not commit or push until he asks. That switch is done. Next chat starts on `master` at `5ed6406`.

Nothing else that night. The last push to GitHub is Devin’s, commit `5ed6406`. Bill has not tested it. He will testdrive on 2026-10-29 and come back with a day’s diagnostic dumps. Until those dumps are in, do not edit the app, do not commit, and do not push. When he returns, keep working on `master` the way the work was done with Devin: read the dumps and use that feedback to tweak and improve. Do not stack new features ahead of that drive.

## Plan after the 2026-10-30 evening GitHub check

No new commits, no open issues, Actions green. Six old pull requests are still open and still based on `907444d` (before the Oct 24 master moves). Leave them. Do not merge.

Next product step is still the drive, not more code. Install or confirm TestFlight **551** from `master`, drive it, bring the diagnostic dumps. Then tweak only what those dumps show. Apple organization membership stays the separate track: D-U-N-S, then Switch to organization. CarPlay Navigation stays unrequested until Apple’s email path is used. Do not push.

## What Bill said on 2026-10-31

He set the yearly Plus price in App Store Connect. Apple had no $49.90 price point, so he chose **$49.99**. It starts Monday 2026-11-02. Until that morning the store still charges **$39.99**. Monthly stays **$4.99**. The one-month free offer stays on the monthly plan only, and only when Apple says that phone is eligible.

Yearly is ten months of the monthly price, which is two months included. $49.99 is nine cents over $4.99 × 10. He asked to keep that deal. Do not put the yearly price back to $39.99 or $49.90.

He then asked to push this copy to GitHub so TestFlight builds, deploy the public terms page, and put these notes on GitHub. The commit changes the in-app fallback and the yearly button to **$49.99** and **2 months included**, plus `web/public/terms.html`. `web/src/` also changed, so the TestFlight build is the one that carries the button text. Netlify rebuilds because `web/public/terms.html` changed. Do not deploy the Cloudflare rainviewer worker. Do not ship an App Store binary unless he asks. The drive of the previous build and the diagnostic dumps are still outstanding. Do not stack more features ahead of those dumps.

## What Bill said on 2026-10-30

No diagnostic dumps in this chat. No app code was changed. The drive-test gate above still stands.

StormPath is already on the App Store. There are no customers yet. Public site remains `https://stormpath2.netlify.app`.

CarPlay: Apple Developer Relations emailed him. Case-ID 22965569. They are reviewing a CarPlay navigation request and asked for a reply with Drive screenshots of turn-by-turn guidance (distance, street name), a description of upcoming-maneuver voice, and the App Store link. He already sent the store URL. Do not press + on Audio, Driving Task, Voice Based Conversation, or any other CarPlay row. Entitlement stays off until Apple grants Navigation (`com.apple.developer.carplay-maps`). Follow-up emails must include the line `Case-ID: 22965569`.

WeatherKit: the App Services tab showed the WeatherKit box unchecked. The app does use WeatherKit for forecasts, through the Netlify token, not a key inside the phone app. He was told not to press Save. Do not enable that box unless he asks. MusicKit and ShazamKit stay off.

He was filling out Devin for Startups (credits). Not confirmed submitted. Do not rewrite that form unless he asks. He is not on LinkedIn or Twitter. GitHub `https://github.com/aaronpeck77` is the public page if a form will not accept a blank link.

Apple company check is in progress and paused on a D-U-N-S number. See below. Do not restart that from memory of the EIN.

## Apple — seller name

Bill does not want his personal name on the App Store. The seller name is the Apple Developer membership. An individual membership shows his legal name. PeckTeck LLC shows only after the membership is an organization.

He is on the right screen. Developer account → Membership details → Update your information. Two cards: “Change contact details” and “Switch to organization membership.” Use the right card, then Provide updates. Changing the name at account.apple.com does not change the store seller. The Apple Business page “Verify PeckTech LLC” (`business.apple.com`) is a different product. Its app list is empty. Its Business ID check said it takes an EIN and then returned “Unable to validate at this time.” It does not change the App Store seller. On 2026-10-30 evening an email (not a page on the site) showed “Provide verification information” and warned that the organization is deleted if it is not verified by the date in Organization settings. The email does not print the date. That date is at business.apple.com → Settings → Organization. Apple’s published window is 60 days after that organization was created. What that warning deletes is the Apple Business organization and its work accounts. It does not delete the Developer membership or the App Store app. Verification there asks for two methods. A D-U-N-S number can be one. The seller-name change is still Switch to organization membership after Apple can see the D-U-N-S number.

The organization form asks for a D-U-N-S number. The EIN is not that number. He has an EIN. He does not have a D-U-N-S yet.

Free request: `https://developer.apple.com/enroll/duns-lookup/` and Apple’s page `https://developer.apple.com/help/account/membership/D-U-N-S/`. Do not pay a site to rush it. Apple says paying does not shorten the wait: up to 5 business days for the number, then up to 2 more before Apple can see it. Use the legal name on the state filing. He has typed both PeckTeck and PeckTech. The paper wins. He must be the founder. After the number is in Apple’s system, go back to Switch to organization membership. Do not ask him to paste the EIN or the D-U-N-S number into chat.

## Devin’s kit (Bill likes it)

On `master` only, about 4,000 lines, Oct 23–28. Do not revert it. Do not rebuild it on `native/drive` unless he asks. Open cautions, not a rejection:

- Jam offer stays quiet until the slow stretch is inside 5 miles. Dismiss sticks to the stretch. Leave rules are unchanged: next exit still ahead, take it when close, stay in the queue when that exit is the end of the jam. `TRAFFIC_BYPASS_ENABLED` stays false. Do not auto-take.
- Landscape dock keeps the turn line beside the controls. Plus drive can show the next real hazard when the next turn is still more than a mile out.
- Monthly trial copy shows only when the store says the phone is eligible. TestFlight iOS builds now receive `VITE_REVENUECAT_API_KEY_IOS` if that secret exists. Yearly includes two months at **$49.99**, starting 2026-11-02. See the 2026-10-31 section. Do not change that price in copy or in App Store Connect unless he asks.
- Offline: two mechanisms. The native TileStore corridor pack downloads at Go only when `NATIVE_DRIVE_MAP_ENABLED` is true. That flag is still false, so the pack does not run. What does run is an IndexedDB copy of Mapbox map resources in the web map: zoom 13 and below, 500 pieces (40 essentials, 300 home, 160 corridor), dropped after 30 days, traffic tiles excluded. Offline camera clamps to zoom 13.9. That is a city-zoom fallback, not a drive-zoom trip download. The Swift pack took several API-fix commits. Do not flip the native-map flag, and do not treat this as finished P2, until he asks and a dead-zone drive has been done.
- If Core sends a new line mid-trip and the app refuses to draw it, master hands the puck and banner back to the in-app guide and turns Core’s voice off for that trip. Core keeps running. The first line of a trip can still be refused without that handoff. This needs a real drive before a store or TestFlight build is cut from master.

## Phone builds

2026-10-31: Bill asked to push the yearly price copy. That push starts a new TestFlight. Build number is `github.run_number`. The previous green TestFlight was run `40786369918` (run number 551) on `5ed6406`. Do not dispatch another workflow by hand.

Older Forge chat build 520 (run `39694149881`, commit `9b24d1c` on `native/drive`) is behind master. The drive to report is 551 on `master`, if that build is the one on the phone.

Build 520 includes, on top of 519: user-selected downloaded voice, Horizon km/h-mislabeled-as-m/s fallback, refresh no longer rewinds the banner, town reroute lookback, idle hard-exit. Build 519 commit `cfe54ec` removed the assistant dock.

## Locked product decisions

- Voice is exactly one of No voice, Basic, Downloaded. Default No voice. Downloaded uses the iPhone Spoken Content voice. A Siri voice cannot be used. Basic still uses the compact en-US voice. Stormy map button shows only when Basic or Downloaded is on. Grok/ChatGPT dock stays off the UI. Server grok code can remain. Do not turn the dock back on unless he asks.
- Add-a-stop UI stays only before Go. After Go, do not splice the locked line. A mid-drive coffee stop re-measures from current GPS, coffee is a via, original destination stays the end, then the drive resumes. Do not use handleStopAndClear.
- Jam hop: severe congestion at least 80, a real stretch, leave the dead mainline via Mapbox `exclude=point`. If already in the queue, wait for the next exit still ahead. Take it when within about 0.5 mi and at least about 2 miles of jam remain past that exit. Otherwise stay in the queue. One new measurement to the same destination, then handleGo. Do not restore the old pin-window or motorway-ban hop.
- Horizon is on in the native plugin: length 10 km, expansion 0, branch 50 m, min time delta 2 s, `enableEnhancedDataAlongEH` false. Posted speed: Horizon mph wins with no “est”. Else Directions maxspeed labeled “est”. Else US road-class average labeled “~est” (interstate 70, US/state 55, county 55, local 30). Hide class estimates outside the US. Do not invent a limit when Horizon returns nil. `locationMatching.speedLimit` is not proof the sign is known. Live incidents stay off until Bill pastes a real Mapbox graph name. Do not guess one. Do not paste the access token.
- Idle quit: no trip and off screen about 20 seconds, native `exit(0)` only if the app is in the background. A drive after Go stays alive. GPS watch stops when backgrounded with no trip.
- CarPlay entitlement stays off until Apple grants it. Case-ID 22965569 is the open Navigation review. Do not request a different CarPlay category.
- P2 offline trip download was talk-only on Forge (“just talking”). Devin built a version on master. Bill likes Devin’s kit. Still do not flip the native pack on or bake a region into the 85 MB app unless he asks.
- Radar tile scale: Netlify `rainviewer-tile` is the launch path. Cloudflare worker in `cloudflare/rainviewer-tiles` is a reminder only if radar shuts off, 429s, or store scale. Do not deploy it unless he asks. Docs: `docs/CLOUDFLARE_TILES.md`.

## Public site and store size

- Site: `https://stormpath2.netlify.app` (privacy, terms, support under that host). Do not deploy unless he asks.
- He reported the App Store size as 85 MB. That is the compressed download. Installed size is larger. Do not fill spare size with a regional map or a local model.

## Do not

- Commit `.env`, Apple keys, or certificates.
- Commit or push unless he asks. That includes this notes folder and `docs/BRAIN.md` / `docs/BRAIN_THINKING.md`.
- Leave `master`. Do not switch back to `native/drive`, open another branch, revert `master`, or push it unless he asks. A push to `master` starts TestFlight.
- Print secrets. Do not ask him to paste the EIN, D-U-N-S, or SSN.
- Enable enhanced ADAS. Invent an incidents graph id. Turn on `TRAFFIC_BYPASS_ENABLED`. Restore the old surgical jam hop. Re-enable the Grok dock.
- Start a Cursor Automation or `/loop` to “keep thinking.” That burns credits. Only if he asks.
