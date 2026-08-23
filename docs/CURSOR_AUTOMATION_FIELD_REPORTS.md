# Cursor Automation — field supervisor reports → PR

Automations run in **Cursor’s cloud**. They do not run on phones. Use them to turn a Sentry issue or webhook into a **draft PR** you still review.

## Trigger

**Preferred:** Sentry → Cursor Automation

1. In Sentry, create an alert (or internal integration webhook) when a new issue matches:
   - Message starts with `stormpath.health.supervisor.`  
   - **or** tag `health_domain` = `supervisor`
2. Point that webhook at the Cursor Automation inbound URL.
3. Also useful: same Automation on **Slack** if you paste a Sentry link + the extras JSON.

**Without Sentry:** phone POSTs `FieldSupervisorReport` JSON to a small Netlify function; that function calls the Automation webhook. Do not invent a token in git — use a Netlify env secret.

**Do not** fire the agent on every Jeff `drive_camera` / `live_traffic` repair. Those are already noisy and often self-healed. Supervisor events only.

**Dedupe:** one agent run per Sentry issue fingerprint (`stormpath.health.supervisor.{watchId}` + release). Ignore repeats of the same issue for 24h unless `userCount` jumps.

## What the agent gets

- Sentry issue title, `health_code`, extras JSON (`stormpath.field_supervisor.v1` if present).
- Repo: `aaronpeck77/StormPath`, default branch `master`.
- This prompt (below).

## Agent prompt (paste into the Automation)

```
You are a StormPath field-resilience agent. You do not deploy. You do not merge.

Context
- Product: driving-first multi-route nav (Vite + React in web/, Capacitor iOS).
- Phones freeze / look confused / lose trip state in cell dead zones.
- On-device supervisor (docs/FIELD_RESILIENCE_SUPERVISOR.md + web/src/monitoring/supervisorWatchList.ts) may have already applied a FIXED recovery. You propose a CODE fix so the hang is less likely next build.
- Existing drive watchdogs (Jeff / camera / traffic / route-ahead) are out of scope unless the report's watchId is one of the supervisor ids.

Input
- A Sentry issue or webhook body. Prefer extras that validate as FieldSupervisorReport (schema stormpath.field_supervisor.v1).
- If the payload is not that schema, still use health_code / message suffix as watchId only if it is in SUPERVISOR_WATCH_IDS.

Hard rules
1. Branch: cursor/<short-name>-4ba7 from latest master. Draft PR only.
2. Only change code needed for THIS watchId. No drive-camera refactors. No App Store / IAP / Netlify deploy.
3. Never invent an on-device LLM or “smart” recovery. Only extend the listed SupervisorRecovery values.
4. Do not log destination names, search strings, or coordinates to Sentry.
5. Prefer abort + keep last good over refetch storms.
6. If you cannot find a concrete bug, open no PR: comment on the issue with the files you read and stop.
7. Do not commit .env or Apple keys.

Per watchId (start here)
- routing_hang → useComputeRoutes, mapboxDirectionsRouter, App routeMainFetchAbortRef, fetchResilient 55s timeout. Make cancel + setRouting(false) reliable; consider skipping Directions when reachable=false.
- search_hang → useDestinationSearch suggest path: add .catch(), clear suggestLoading, abort or ignore stale seq.
- bypass_hang → traffic bypass / route compare busy + abort.
- traffic_overlay_stuck → useTrafficOverlayFetch: abort on teardown; set trafficFetchDone true on cancel/offline.
- storm_alerts_hang → useStormCorridorPolling / NWS: timeout already ~22s; ensure stormLoading clears.
- false_online → do not trust navigator.onLine alone; add a short probe; gate Directions/search/traffic.
- ops_pending_flush → mapboxUsageMeter: listen for online / probe-ok and flush; do not drop pending on failure.
- trip_cache_stale → useActiveTripCache / tripCache: do not shorten TTL in a way that drops trips; only make saves more reliable.
- go_without_geometry → trip surface / GO: if no geometry after maxMs, exit nav to plan without wiping dest.
- weatherkit_token_hang → weatherKitAuth.ts: add fetchWithTimeout; keep the 2 min error block.

Checks
- Add or extend a vitest test next to the file you change.
- Run the focused web tests for those files.
- PR body: watchId, Sentry link, what the phone already did, what the code change does, how to verify (airplane mode + GO / search).

If the report says recovered=true, still fix the root hang (the recovery is a bandage).
```

## You still do

Create the Automation in [Cursor Automations](https://cursor.com/automations) (cloud, Sentry or webhook trigger). Paste the prompt. Connect the Sentry project that already uses `VITE_SENTRY_DSN`.

The phone supervisor is **not** implemented yet — only the watch list and this trigger. When the poller ships, these issues will start appearing.
