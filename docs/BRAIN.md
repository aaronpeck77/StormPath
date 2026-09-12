# StormPath Brain (Forge)

**What this is:** A living notebook on Forge for Bill + Cursor agents. It holds ideas, research, and connections so we can improve StormPath over time.

**What this is not:** Not a feature inside the app. Not a runtime service. Nothing here is “plugged into” TestFlight or the App Store unless Bill later asks to *build* a specific idea into product code.

**How we use it**

- Capture ideas (even half-formed) so they don’t get lost between chats
- Link related thoughts (weather UX ↔ route advisory ↔ tiers ↔ map behavior)
- When Bill is ready to ship a change, pick an idea out of Brain and implement it in `web/` / docs as usual
- Active ship / bugfix work stays in chat and code — Brain is for *later* and *thinking*

**Current product focus:** Store app stays on **`master`** (4.20.8, leave it alone — wait until it actually appears on the store before any new App Store submit). **Brain Priority 1 is open** on branch **`native/drive`** — Core owns Drive after Go. **Priority 2** (revisit later): Download this trip for offline. See `docs/NATIVE_TRACK.md`.

### Dual track (do not mix)

| Track | Branch | Rule |
|-------|--------|------|
| Live App Store / gold-restore web Drive | `master` | Do not merge native experiments here. Do not “fix” store nav from `native/drive`. |
| Native Drive (P1) | `native/drive` | Daily work. TestFlight only when Bill asks. Never App Store until he promotes. |

### Stability gate (store path — leave alone for now)

Store binary accepted ~Sep 11, 2026 (4.20.8). Soak testers. Do not bump / resubmit unless Bill asks.

- [x] App Store path clear — **4.20.8** accepted ~Sep 11, 2026
- [ ] Testers like the store build (people, not more weather)
- [ ] Alternate route at Go stays locked in Drive (store / `master`)
- [ ] No show-stopper crashes on a real drive (store)

---

## Priority 1 — Native-feel navigation (OPEN on `native/drive`)

**Bill’s call (Sep 11, 2026):** Store version is good enough to leave alone. What’s missing is **following** — puck on screen, cam that does not freeze or fly to Canada — vs Apple / Google / Waze. Thicken the **native shell**; keep web for weather, Route info, About.

**Do not:** throw away the Capacitor/web app. Do not rewrite About/weather in SwiftUI. Do not merge this into `master` or ship store from this branch until Bill says the soak is better than gold.

### Build order

1. **Native last-good pose** — done (`DrivePoseHold` + `nativeDrivePoseHold.ts`).
2. **Native follow-cam owner** — done (`DriveFollowCam` + DriveMap slave apply).
3. **Native puck overlay** — done (`DrivePuckOverlay`, heading-up, 30-yard line).
4. **Native map under chrome** — in TestFlight soak (`DriveNativeMap` / `NavigationMapView`). Core prepares the locked corridor before Go, owns the Drive line / puck / reroute, predictive-caches tiles along the trip. Not a SwiftUI rewrite of About/weather.

**Bill (Sep 12, 2026):** TestFlight this branch to soak. Do **not** send this train to the App Store until 4.20.8 is actually live on the store and he decides the native soak is better.

Existing plugin: `web/plugins/stormpath-mapbox-navigation/` (`StormpathMapboxNavigationPlugin.swift`).

### How to work this idea

```bash
git fetch origin
git switch native/drive
```

Cue phrases: *“open Brain P1”* (already open), *“TestFlight this native branch”* (only when Bill asks), *“offline trip download”* (P2 — do not build until he asks).

---

## Priority 2 — Download this trip for offline (REVISIT later)

**Bill’s call (Sep 12, 2026):** Good feature. Do **not** build it in the current native Drive soak. Park it here as the next Brain priority after P1 following is solid on a phone.

**What it is:** After a route is planned (on Wi‑Fi), a StormPath control: **Download this trip**. Native `TileStore` saves a **corridor tube** around the locked A/B (plus a bit around start/end) — map tiles + navigation tiles — so Core can follow and reroute with no cell. When the trip ends, offer **Remove downloaded trip**.

**What it is not:** “Download the United States.” That blows Mapbox’s ~750 tile-pack cap and fills the phone. Not a full StormPath-offline mode — weather, radar, NWS, live traffic, and search still need the network.

**Why it waits:** P1 has to own the Drive line first. A download button in front of the old thinned web polyline would not retain anyone. Needs a real UI (size estimate, progress, cancel, storage warning) and native iOS work the web map cannot do.

**Build notes (when Bill opens this):**

- Corridor geometry, not a state/country bbox. Highway zoom in the middle, street zoom near start/end if size is huge.
- Wi‑Fi preferred. Show “about X MB / ~N minutes.”
- Use the same Mapbox Navigation `TileStore` already created by Core (`tilestoreConfig.navigatorLocation.tileStore`).
- Predictive cache (already on after Go) stays; this is the *before you leave driveway* pack.
- Web / Netlify: no-op. Phone only.

Cue phrases: *“open Brain P2”*, *“offline trip download”*, *“download this trip.”*

---

## Dark Sky–inspired route nowcast (shelved Sep 10, 2026)

**Bill’s call:** We may never go this direction. StormPath **already surpasses** what Dark Sky did (radar, corridor, NWS, advisory, graphs). What’s missing is **following**, not another weather product. Native-feel Drive (Priority 1) is the survival problem.

**Status:** Shelved. Do not pull forward, do not implement, do not treat as next Brain item. Keep the notes below as archive only.

**Context (Aug 2026):** Dark Sky was loved for hyperlocal clarity (“rain in 12 minutes *here*”), minute-level curves, glanceable UI, and context that changed emphasis (rain vs wind vs temp). Apple Weather has much of the data but buries the answer. StormPath’s lane is **not** a weather app clone — it’s **Dark Sky clarity for the corridor you’re driving**.

### Not proposing

- Rebuild Dark Sky’s app or copy its visuals
- Swap core weather stack to Pirate Weather / Dark Sky API (Tomorrow.io, WeatherKit, NWS, radar stay primary)
- Big pivot away from navigation
- Paid speed-limit or weather vendors for this
- Shipping Brain as part of the app

### Possible StormPath angles (when we choose to build)

| Dark Sky habit | StormPath equivalent |
|----------------|----------------------|
| “Rain in 12 min here” | “Rain on **your route** in ~X min / at mile Y” |
| Next-hour precip curve | Along-route strip on **progress rail** (distance ahead, not clock at home) |
| One glance | Drive advisory banner + compact strip: what matters **on the road ahead** |
| Hyperlocal | Tie to **GPS along locked route**, not destination city only |
| Plain language | e.g. “Light rain ahead for 6 mi” — not a wall of metrics |

### Directions to decide before any build

1. **Nowcast-first advisory (Basic?)** — Lead with next weather event on route; hourly/7-day stay Plus if desired.
2. **Minute-style strip on progress rail** — Precip/radar bands aligned to miles ahead.
3. **Context switching** — Dry now + rain in 20 min on route → banner/voice; NWS polygon on route beats generic “30%.”
4. **Reduce tap depth** — Answer in 1–2 seconds like Dark Sky; avoid Apple-Weather layering.
5. **Optional experiment only:** Pirate Weather as dev backup forecast — not required for the *feel*.

### Open questions

- Hero message: rain timing vs hazard miles vs both?
- Tier: nowcast Basic, long-range Plus (align with `docs/PAY_TIERS.md`)?
- Surface: Drive banner only, progress rail, map overlay, or one shared headline?
- Scope: polish existing advisory pipeline vs dedicated “Route nowcast” panel?

### References (public, not code)

- [Nightingale — Dark Sky eulogy / data viz](https://nightingaledvs.com/dark-sky-weather-data-viz/)
- [Pirate Weather](https://pirateweather.net/) — open Dark-Sky-shaped API (optional later)

---

## How agents should treat Brain

- Read this file when Bill mentions Brain, post-launch ideas, or Dark Sky direction
- Add new sections below as ideas appear; connect them when related
- **Never** treat Brain content as something to auto-ship into the IPA / App Store
- **Priority 1** is native-feel Drive on `native/drive` (opened / TestFlight soak). **Priority 2** is offline trip download — revisit later, do not build until Bill asks. Dark Sky is archive-only — do not pull it forward
- Do not merge `native/drive` into `master` or run the App Store workflow from it unless Bill asks
- Implement other Brain ideas only when Bill explicitly asks
