# Field resilience supervisor (sync / offline / stuck UI)

Phones in dead zones freeze, look “confused,” or drop trip state. That is a **client** problem. Cursor Automations do **not** run on the phone and cannot keep the app alive offline.

**Split**

| Where | Job |
|--------|-----|
| **Phone** | Watch a fixed list. Do only listed recoveries. Report if that is not enough. |
| **Cursor Automation** | Sentry / webhook → read repo → open a **draft PR** or Slack summary. |
| **You** | Review and ship. |

No in-app LLM. No invented recoveries on device.

## What already exists (do not rebuild)

Jeff-style pollers already watch **drive camera, puck, live traffic, route-ahead, nav display, trip surface, map layers**. They call `reportAppHealthRepair` → Sentry (`web/src/monitoring/appHealthSignals.ts`). They do **not** watch busy flags, search hangs, ops queues, or false-online.

| Watch | Code | Recovers |
|--------|------|----------|
| Drive heading / puck | `useDriveCameraHealth` | Resync follow-cam |
| Live traffic stale | `useLiveTrafficHealth` | `bumpTrafficRefresh` |
| Route-ahead desync | `useProgressCalloutPanel` | Forecast / traffic bump |
| ETA / along-route | `useTripNavDisplayHealth` | Reset along-hold |
| Missing geometry / steps | `useTripSurfaceRecovery` | Fit + refresh |
| Missing route lines | `DriveMap.tsx` | Re-sync layers |

Jeff sightings (`jeffTheBot.ts`) do **not** flush to Control Room. `startJeffFixLogFlusher` is not started in `main.tsx`. Leave that as a later reconnect — not required for this supervisor.

## Persistence (what “data loss” means)

| Store | Code | Risk in a dead zone |
|--------|------|---------------------|
| Settings / recents / pending ops | `safeStorage` → Capacitor Preferences | Native write can fail silently; cache is session-only |
| Active trip | IndexedDB `tripCache` / `useActiveTripCache` | Saves at most every **20s**; last edits can vanish on kill |
| Weather / tiles in RAM | various inflight maps | Gone on process death — expected |

The supervisor must **not** wipe Preferences or IndexedDB. Worst allowed trip action is “leave GO, keep last plan.”

## Watch list (new supervisor)

Source of truth: `web/src/monitoring/supervisorWatchList.ts`.

Busy flags already drive the advisory pill (`useDebouncedBusyLabel`). The supervisor’s job is: **if a flag stays true too long, cancel and clear it** instead of waiting out a 55s Mapbox hang.

| id | What we watch | Stuck after | Recovery | Report |
|----|----------------|-------------|----------|--------|
| `routing_hang` | `routing` — Directions via `useComputeRoutes` (55s timeout) | 20s | Abort controller + `setRouting(false)`; keep last plan | Always |
| `search_hang` | `suggestLoading` — `useDestinationSearch` (no `.catch` today) | 12s | Clear loading + suggestions; do not apply stale results | Always |
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

1. Only run `watch.recover` from the table (or `report_only`).
2. One recovery per watch per 60s (separate from Sentry’s 5 min health cooldown).
3. Prefer **keep last good**. Never empty `plan` or `destLngLat` to “fix” a hang.
4. If `navigator.onLine` is true but the probe fails, set an in-memory `reachable=false` and skip new network work until a probe succeeds or a real `online` event + probe ok.
5. On a real `online` / foreground: flush mapbox usage pending; retry token if blocked.
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

## Build order (when you say go)

1. Wire a poller that only implements `search_hang` + `routing_hang` (highest freeze risk).
2. Add `.catch()` on destination autocomplete (bug, not a watchdog).
3. Reachability probe + skip Directions when unreachable.
4. `online` listener → `flushMapboxUsage`.
5. Then the rest of the table.

Automation setup (trigger + agent prompt) is in [`CURSOR_AUTOMATION_FIELD_REPORTS.md`](CURSOR_AUTOMATION_FIELD_REPORTS.md).
