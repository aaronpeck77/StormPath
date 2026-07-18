# @stormpath/mapbox-navigation

Capacitor iOS bridge to **Mapbox Navigation Core** (not full-screen UIKit nav).

StormPath’s WebView keeps Dr / Mp / Rt. The SDK owns snap, progress, off-route, and reroute; progress events update shared JS nav state.

## Do you need a Mac at your desk?

**No.** StormPath already builds the IPA on **GitHub Actions** (`macos-latest` in `.github/workflows/ios-build.yml`). That runner is the Mac. You develop on Windows, push, install from TestFlight.

You only need a personal Mac if you want to open Xcode locally.

## Token setup (CI)

1. Mapbox account → create a **secret** token with `Downloads:Read`.
2. GitHub → Settings → Secrets → Actions → add **`MAPBOX_DOWNLOADS_TOKEN`** = that secret token.
3. Keep existing **`VITE_MAPBOX_TOKEN`** (public token) — CI already uses it for the web bundle and writes `MBXAccessToken` into Info.plist.

## Optional: local Mac / Xcode

If you ever archive on a Mac yourself, put the secret token in `~/.netrc` (not in the repo):

```
machine api.mapbox.com
login mapbox
password sk.YOUR_SECRET_TOKEN
```

```bash
chmod 600 ~/.netrc
```

## API

- `isAvailable()` → `{ available: boolean }` (true only on native iOS with plugin)
- `startActiveGuidance({ accessToken, coordinates: [{lng,lat}], simulate? })`
- `stop()`
- Events: `progress`, `routeChanged`, `arrived`, `cancelled`, `error`

## Cost

Uses Mapbox Navigation SDK metered trips / MAUs. See Mapbox Navigation pricing. Web builds never load this plugin’s native code.

## Build / verify (Windows → TestFlight)

1. Add GitHub secret **`MAPBOX_DOWNLOADS_TOKEN`** (above).
2. Commit / push (or run **iOS Build & TestFlight** manually).
3. Install the new build from TestFlight on your iPhone.
4. Plan a route → **Go** → confirm:
   - Dr follow feels solid (SDK snap)
   - Switch **Mp** then **Rt** mid-drive — same puck / corridor
   - Leave the route — SDK reroutes; Rt/Mp update
   - **Stop** returns to planning
5. Vite / Netlify on the PC: unchanged DIY nav (plugin `isAvailable` is false).

If the CI archive fails on a Swift API name (`RouteProgressState`, `mainRoute.route.shape`, etc.), the Nav SDK minor version may have renamed a property — fix the plugin Swift from the workflow log, push again.
