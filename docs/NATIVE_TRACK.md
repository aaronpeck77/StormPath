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
4. **Native map under chrome** — **ON** (`NATIVE_DRIVE_MAP_ENABLED` + follow-cam). `NavigationMapView` under the WebView after Go (route + puck + follow-cam). Soft-stop keeps Core provider on Stop. Weather/About stay web. Mp/Rt stay on the web map.
5. **Download this trip (offline corridor)** — Brain **Priority 2**. Do not build until Bill opens it. See `docs/BRAIN.md`.

## How to work

```bash
git fetch origin
git switch native/drive
git pull
```

Push **this branch only**. CI iOS workflow does **not** auto-run on `native/drive` (only `master` / `main`).

When a native slice is solid on a phone TestFlight, Bill can promote (merge/cherry-pick) — never the other way around while store is “good enough.”
