# Next app vision — driving-first multi-route navigation

Distilled alignment for the greenfield app (not StormPath). Copy or keep this repo as the source of truth.

## What you’re building (in plain terms)

| Phase | What happens |
|--------|----------------|
| **Open** | Map on you, smart default zoom (city vs rural), easy pan/zoom. |
| **Destination** | Search + suggestions, saved places, optional **voice → confirm → route**. |
| **Pick route** | **3 live options**: fastest, 2nd-best (tunable), hazard-smart (checklist/layers). |
| **Drive** | **Drive view = primary**; optional **PiP 2D overhead**; **full-route** view; quick toggles. |
| **While moving** | **All 3 routes keep updating** (weather, conditions, incidents, traffic). **Color + small flags**; tap for detail. |
| **Control** | **Switch active route anytime**; **lock** until something meaningfully better or the hazard is past. |

That’s a **driving-first, multi-route command center** — not “one line and hope.” StormPath moved toward some of this; this app **centers the whole product** on that loop from day one.

## What you see (visual + control loop)

**Yes — same picture:** an **always-updating multi-route** view: several live alternatives on the map (or one active with the others one tap away), continuously refreshed as conditions change. The system keeps proposing **new or strictly better** options when data warrants it; the driver is never asked to micromanage — only to **confirm** or **pick among a few clear choices**.

**Presets (scope + severity):** Before or at the start of a drive, the user picks a **preset** (not a wall of sliders) that sets how wide the “situation” net is (e.g. local corridor vs long-haul awareness) and how **insistent** the app is (quiet / balanced / protective). That preset drives **what gets surfaced**, **how often** suggestions appear, and **how strong** pause/stop/reroute recommendations are — still always as **short, trip-specific** explanations tied to *this* route and *this* timeline.

**Safety-oriented trip control:** With good data + user intent, the product can support **reroute** (switch active route), **pause** (hold guidance while you wait out conditions), or **stop** (end or park the session) — always as **informed options** with the pertinent facts for *your* drive summarized, not generic alerts.

## When you want code

1. This folder is the greenfield app workspace (or open it in Cursor if elsewhere).
2. Ask to **scaffold v0 from this doc** — structure, map shell, placeholder modules for the three routes, drive/PiP toggles stub, etc.

You don’t need a perfect spec before that — iterate from here. Enough to **start architecture and a thin vertical slice** (map + 3 polylines + one toggle).

---

## Structure: hazard-leaning on a simple nav core

**Principle:** One **navigation kernel** (turn-by-turn, geometry, reroute triggers) stays **small and boring**. Everything about weather, traffic, road conditions, incidents, and “hazard-smart” preference is a **layer on top** that **scores, ranks, and explains** — it never replaces the kernel; it feeds it constraints and weights.

### Fused inputs (all active together)

The product is not separate “modes” you switch between. **At the same time**, the system continuously combines:

| Input | Role in the fuse |
|--------|-------------------|
| **Navigation** | Where you are, where you’re going, candidate routes, ETAs, maneuvers |
| **Radar** | Near-term precipitation / intensity along and ahead of the corridor |
| **Storm forecasting** | Timing and trend (e.g. cells, fronts, windows to move or wait) along the timeline of the trip |
| **Hazard avoidance** | Road- and route-level risks (closures, conditions, incidents, restrictions) scored against each polyline |
| **Traffic** | Live congestion, incidents, and delays on those same options |

All of these feed one **unified situation model** and one **map + voice + choices** experience: same refresh loop, same presets (scope/severity), same multi-route comparison — so reroute suggestions are explained as **traffic + weather + hazards together**, not five disconnected apps.

Suggested mental layers:

| Layer | Role | Keeps simple |
|--------|------|----------------|
| **Nav kernel** | Routes A→B, instructions, recalculation, offline/degraded behavior if needed | No weather UI here — just APIs and polylines |
| **Situation feed** | Ingest **traffic**, **radar**, **storm/forecast** along time + corridor, **hazards** (conditions, closures, incidents), user prefs | Adapters per source; normalize to a **single** internal model for scoring and UI |
| **Scoring / policy** | Turn feeds into comparable route options; decide “meaningfully better” for unlock | One place for business rules (fleet vs consumer later) |
| **Driving UI** | Big targets, voice, **only pre-built choices** (which route, lock, “tell me why”) | Driver never raw-configures 12 toggles at 70 mph |

**Driving UX:** The app **does the synthesis**; the human **confirms or picks among a few labeled options** (e.g. fastest / balanced / hazard-smart). Surprises become **short spoken summaries + one tap**, not dense dashboards.

**Trip length:** Same engine for in-town and long haul. **Defaults and verbosity** can differ (e.g. long trip: more proactive corridor weather and rest-stop context; short trip: quieter unless hazard crosses the route). Avoid two separate apps — one product, **mode-aware** presentation.

**Fleet / trucking (later):** Same stack; add **vehicle profile** (dimensions, weight), **compliance-oriented constraints** into scoring, and **evidence** for ops (time saved, avoided closures, fewer manual checks). Value story: fewer bad decisions on hazard-heavy networks, not just prettier maps.

---

## Platform & providers (locked for this repo)

| Target | Stack |
|--------|--------|
| **Phones** | **Expo + React Native** + **Mapbox** (`mobile/`) — development build required for Mapbox. |
| **Vehicle UI** | **CarPlay** / **Android Auto** later: native templates or RN bridges on top of the same route + fused-situation state (see `mobile/README.md`). |
| **Dev / desktop** | **Vite + React** (`web/`) — same product loop for fast iteration. |

| Credential | Use |
|------------|-----|
| **Mapbox token** | Map style + GL (web `VITE_MAPBOX_TOKEN`; mobile `EXPO_PUBLIC_MAPBOX_TOKEN`). Native SDK also needs a **downloads** secret in `mobile/app.json` for `@rnmapbox/maps`. |
| **OpenRouteService** | Directions: three variants (fastest / recommended / avoid motorways proxy) → `web` loads real polylines when `VITE_ORS_API_KEY` is set. |
| **OpenWeather** | Current weather sampled along each route → enriches fuse headlines when `VITE_OPENWEATHER_API_KEY` is set. **Production:** proxy keys via your backend; do not ship ORS/OW secrets in public apps. |
