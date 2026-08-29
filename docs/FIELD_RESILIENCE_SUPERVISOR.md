# Field resilience supervisor (sync / offline / stuck UI)

Phones in dead zones freeze, look “confused,” or drop trip state. That is a **client** problem. Cursor Automations do **not** run on the phone and cannot keep the app alive offline.

**Split**

| Where | Job |
|--------|-----|
| **Phone** | Watch a fixed list. Do only listed recoveries. Report if that is not enough. |
| **Cursor Automation** | Sentry / webhook → read repo → open a **draft PR** or Slack summary. |
| **You** | Review and ship. |

No in-app LLM. No invented recoveries on device.

## Jeff is the supervisor's drive-map crew

Jeff is **not** a second bot. Camera, puck, and live-traffic polls stay in `useDriveCameraHealth` / `useLiveTrafficHealth`. Recoveries go through `resolveJeffSupervisorRecovery` (`web/src/monitoring/jeffSupervisor.ts`):

| Signal | Healthy link | Dead zone (`holdLastGoodMap`) |
|--------|----------------|-------------------------------|
| Drive heading / puck | Resync follow-cam | **Still** resync follow-cam (GPS on last-good tiles) — do not freeze the camera |
| Live traffic stale | `bumpTrafficRefresh` | Hold last traffic — no doomed fetch |

A manual Jeff tap still resyncs on purpose. Badge + sightings stay. Control Room flush is still off.

Other self-heals (route-ahead, ETA, trip surface, route lines) are unchanged and are **not** Jeff.

## Persistence (what “data loss” means)

| Store | Code | Risk in a dead zone |
|--------|------|---------------------|
| Settings / recents / pending ops | `safeStorage` → Capacitor Preferences | Native write can fail silently; cache is session-only |
| Active trip | IndexedDB `tripCache` / `useActiveTripCache` | Saves at most every **20s**; last edits can vanish on kill |
| Weather / tiles in RAM | various inflight maps | Gone on process death — expected |

The supervisor must **not** wipe Preferences or IndexedDB. Worst allowed trip action is “leave GO, keep last plan.”

## Watch list (new supervisor)

Source of truth: `web/src/monitoring/supervisorWatchList.ts`.

Busy flags already drive the advisory pill (`useDebouncedBusyLabel`). The phone supervisor’s first job is **keep the map moving on last-good tiles**. It also unsticks hung busy flags and decides Jeff’s camera/traffic fixes.

Wired on the phone (`SUPERVISOR_PHONE_WATCH_IDS`): `map_low_signal`, `false_online`, Jeff’s three watches, plus routing / search / bypass / traffic-overlay / storm hangs.

| id | What we watch | Stuck after | Recovery | Report |
|----|----------------|-------------|----------|--------|
| `map_low_signal` | Native radio down (not a stuck WKWebView `navigator.onLine`) | 2.5s handoff grace, then hold | Hold last-good map / camera / road snap | If repeated |
| `jeff_drive_camera` / `jeff_drive_puck` / `jeff_live_traffic` | Jeff polls | see hooks | Resync / refresh, or hold if dead zone | If repeated |
| `routing_hang` | `routing` — Directions via `useComputeRoutes` (55s timeout) | 20s | Abort controller + `setRouting(false)`; keep last plan | Always |
| `search_hang` | `suggestLoading` — `useDestinationSearch` | 12s | Clear loading + suggestions; do not apply stale results | Always |
| `bypass_hang` | `bypassBusy` — traffic bypass / compare | 20s | Abort + clear busy; keep prior compare | Always |
| `traffic_overlay_stuck` | `trafficFetchDone === false` while driving, traffic on, “online” | 40s | Keep last traffic; mark fetch done | If it repeats |
| `storm_alerts_hang` | `stormLoading` with empty NWS corridor | 18s | Keep last polygons; clear loading | If still stuck |
| `false_online` | `navigator.onLine` but a short probe/fetch fails | 8s | Treat as offline; skip new Directions / traffic / search | If it repeats |
| `ops_pending_flush` | `stormpath.mapboxUsage.pending.v1` while actually reachable | 45s | `flushMapboxUsage()` (already exists; no `online` listener today) | If still stuck |
| `trip_cache_stale` | Active trip but no IndexedDB save past the 20s throttle + slack | 45s | Best-effort `saveActiveTripToCache` only — never delete | If still stuck |
| `go_without_geometry` | `navigationStarted` with no route line / no GPS | 15s | Exit GO back to plan; keep dest + last plan | Always |
| `weatherkit_token_hang` | Token `fetch` with **no** timeout (`weatherKitAuth.ts`) | 12s | Abort token; use 2 min block already in auth | If it repeats |

**Do not** abort Mapbox **tile** loads just because the pill is busy. Tiles are not these flags.

**Do not** start a new Directions request from the supervisor. Only cancel a stuck one.

## Recovery rules

1. Only run `watch.recover` from the table, `report_only`, or Jeff’s dead-zone override `hold_last_good_map`.
2. One recovery per watch per 60s (separate from Sentry’s 5 min health cooldown).
3. Prefer **keep last good**. Never empty `plan` or `destLngLat` to “fix” a hang.
4. If `navigator.onLine` is true but the probe fails, set an in-memory `reachable=false` and skip new network work until a probe succeeds or a real `online` event + probe ok. On iOS, **native** `Network.connected` wins over `navigator.onLine` — a Wi‑Fi → cell handoff must not freeze GO. After a healthy probe, keep `holdLastGoodMap` for a short hysteresis (`HOLD_CLEAR_HYSTERESIS_MS` in `mapLowSignalResilience.ts`) so brief dead-zone blips do not thrash style reload / Jeff resync.
5. On a real `online` / foreground: re-read native Network status, flush mapbox usage pending; retry token if blocked.
6. If recovery runs and the same watch fires again within 2 minutes → report (even if `reportWhen` is `if_repeated`).

## Field report

Sentry message: `stormpath.health.supervisor.{watchId}`  
Tags: `health_domain=supervisor`, `health_code={watchId}`  
Extras: the JSON from `buildFieldReport()` (`schema: stormpath.field_supervisor.v1`).

Includes: recovered, recovery, `navigatorOnLine` vs `reachable`, screen, busy flags, pending queue sizes, stuckMs, version, ios build, flavor. **No** destination text, search query, or GPS.

Same JSON can POST to a webhook when Sentry is off.

## What we are not doing

- In-app AI that invents fixes.
- Cursor SDK inside the IPA.
- Automations as a substitute for timeouts / abort / local persistence.

## Build order

1. **Done:** `search_hang` + `routing_hang` hang recoveries.
2. **Done:** `map_low_signal` / `false_online` hold last-good map; Jeff merged via `resolveJeffSupervisorRecovery`. Online uses Capacitor Network + a 2.5s Wi‑Fi→cell grace (`useAppOnline`) so a driveway handoff does not freeze the map.
3. Wired: bypass / traffic-overlay / storm busy-flag unsticks.
4. Still contract-only: `ops_pending_flush`, `trip_cache_stale`, `go_without_geometry`, `weatherkit_token_hang`.

Automation setup (trigger + agent prompt) is in [`CURSOR_AUTOMATION_FIELD_REPORTS.md`](CURSOR_AUTOMATION_FIELD_REPORTS.md).
