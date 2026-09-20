# Native Drive track (`native/drive`)

**Store / customers:** stay on **`master`**. The live App Store app (4.20.8) is that path. Do **not** merge this branch, run the **appstore** workflow from it, or “fix” store nav from here until Bill says the native soak is better than gold.

**This branch:** Brain **Priority 1** — thicken the **native shell** so Drive feels like Apple / Google / Waze (puck stays on screen, cam does not freeze or fly to Canada). Web UI (weather, Route info, About) stays web.

## Two apps, one repo

| Track | Branch | What Bill does |
|-------|--------|----------------|
| Store / gold-restore web Drive | `master` | Leave alone. TestFlight only if he asks. |
| Native Drive | `native/drive` | Daily work. TestFlight **testflight** track when he asks — never App Store until promoted. |

Forge leftover desktop camera experiments are **not** this track (stashed off `master`).

## What “aggressive native” means (in order)

1. **Native last-good pose** — done. Hold leaps in Swift before JS sees the puck.
2. **Native follow-cam owner** — done. iOS decides zoom/center/bearing/pitch; DriveMap applies only.
3. **Native puck overlay** — done. Heading-up chevron pinned to the 30-yard line.
4. **Native map under chrome** — **OFF** as of Sep 15 2026 (`NATIVE_DRIVE_MAP_ENABLED = false`). It was on Sep 13–15 and taught us what we needed: reliability came from steps 1–2 (one owner on the Core side), not from the native renderer. Stacking `NavigationMapView` under the WebView is what made Drive flicker and show the old map through, so Drive is back on the StormPath map with Core still owning snap / position / follow-cam / voice / reroute / stop. The whole native path stays in place behind the flag for A/B. Known trade: we give up Core's predictive tile cache for the *map*, so watch tile behavior on a dead cell (`mapLowSignalResilience` holds the last good map during nav).
5. **One camera queue** — done Sep 19 2026, corrected Sep 20. `resolveDriveCameraCommand` (`web/src/ui/driveCameraQueue.ts`) is the single per-frame decision: drone > resync > follow. Jeff, the chrome-settle snap, and reclaim publish intents; only the rAF loop writes to Mapbox. This replaced the many-writer design that produced the 435 dump. **A radio hold degrades the writer, it does not stop the camera** — 438 froze for 125 s of a 240 s drive and the puck left the screen. Hard follow needs no tiles, so we keep following over bare background.
6. **Drive-zoom tile warm** — done Sep 19 2026. `driveZoomTileWarm.ts` warms the next ~8 mi at **z15–16** with the tileset groups the live style actually requests (`mapStyleTileSources.ts`). The old z10–13 corridor warm was both the wrong zoom for a camera at z16.6 and the wrong cache entry. This is the cheap half of offline — **not** P2.
7. **One pose / one reroute owner** — done Sep 19 2026. While Core is fresh the puck interpolates Core's enhanced location and the DIY polyline snap is skipped (`drivePoseSource.ts`; About shows `puck core` / `puck gps`). Core owns reroute; DIY plans only when Core is absent, abandoned, quiet, or produced nothing within 12s of a confirmed off-route (`rerouteOwner.ts`).
8. **Download this trip (offline corridor)** — Brain **Priority 2**. Do not build until Bill opens it. See `docs/BRAIN.md`.

## How to work

```bash
git fetch origin
git switch native/drive
git pull
```

Push **this branch only**. CI iOS workflow does **not** auto-run on `native/drive` (only `master` / `main`).

When a native slice is solid on a phone TestFlight, Bill can promote (merge/cherry-pick) — never the other way around while store is “good enough.”
