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

*(empty — add a note when corridor cache / Core TileStore work teaches us something)*

---

## P1 — Native-feel Drive

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
