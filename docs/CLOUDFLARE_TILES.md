# Cloudflare tile proxy (App Store scale)

Tomorrow.io map radar on **TestFlight / App Store** cannot call `api.tomorrow.io` directly from the Mapbox WebView (CORS). StormPath uses a **tile proxy** with the same path shape as the Netlify function:

```text
{PROXY_BASE}/tomorrow-io-tile/{z}/{x}/{y}/precipitationIntensity/{timestamp}.png?apikey=...
```

**Netlify** (`stormpath2` function) is fine for launch and low traffic. For **thousands of users**, use this **Cloudflare Worker** — it caches each unique tile at the edge so one origin fetch serves every driver viewing the same radar frame.

| Service | Role |
|---------|------|
| **Cloudflare Worker** (`cloudflare/tomorrow-io-tiles`) | Scalable, edge-cached TIO map tiles for native app |
| **Netlify** (`stormpath2`) | Static site, legal pages, `weatherkit-token`, web app, **fallback** tile proxy |
| **RainViewer** | Direct from app (no proxy); hybrid nowcast segment |

---

## 1. Create a Cloudflare account

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) and sign up (free tier is enough to start).
2. No domain is required for the first deploy — you get a `*.workers.dev` URL.

---

## 2. Install Wrangler (one time)

From the repo root:

```bash
cd cloudflare/tomorrow-io-tiles
npm install
npx wrangler login
```

`wrangler login` opens a browser to authorize the CLI.

---

## 3. Set the Tomorrow.io API key (server-side)

Store your key as a **Worker secret** (not in git):

```bash
npx wrangler secret put TOMORROW_IO_API_KEY
```

Paste the same key you use for `VITE_TOMORROW_IO_API_KEY`. The worker uses this when the client omits `?apikey=` (recommended for production builds once the secret is set).

---

## 4. Deploy

```bash
npm run deploy
```

Wrangler prints a URL like:

```text
https://stormpath-tomorrow-io-tiles.<your-subdomain>.workers.dev
```

**Smoke test** (replace subdomain):

```bash
curl -I "https://stormpath-tomorrow-io-tiles.<subdomain>.workers.dev/health"
curl -I "https://stormpath-tomorrow-io-tiles.<subdomain>.workers.dev/tomorrow-io-tile/4/14/6/precipitationIntensity/now.png"
```

Second request should return `200` and `image/png` (with `apikey` in query if you did not set the secret).

---

## 5. Point the app at Cloudflare

The app reads **`VITE_TOMORROW_IO_TILE_PROXY_URL`** at **build time** (baked into the IPA).

**Base URL** = worker origin + `/tomorrow-io-tile` (no trailing slash), e.g.:

```text
https://stormpath-tomorrow-io-tiles.your-subdomain.workers.dev/tomorrow-io-tile
```

### Local TestFlight-style build

In `web/.env.local` or `web/.env.testflight`:

```env
VITE_TOMORROW_IO_TILE_PROXY_URL=https://stormpath-tomorrow-io-tiles.your-subdomain.workers.dev/tomorrow-io-tile
```

Then rebuild the iOS app (`npm run build:ios:testflight` or your usual archive flow).

### GitHub Actions TestFlight

Add repository secret:

| Secret | Value |
|--------|--------|
| `VITE_TOMORROW_IO_TILE_PROXY_URL` | `https://…workers.dev/tomorrow-io-tile` |

Ensure `.github/workflows/ios-build.yml` passes it into the Vite build (add the env line if not present yet).

### Netlify web builds (optional)

Site → Environment variables → **Builds**:

`VITE_TOMORROW_IO_TILE_PROXY_URL` = same URL (only affects native if you ship a Capacitor web build; browser US users still hit TIO direct or same-origin Netlify function).

---

## 6. Verify on device

1. US location, map radar **on**.
2. Attribution should still show Tomorrow.io (not RainViewer) when the proxy works.
3. If the worker is down, the app falls back to RainViewer after repeated tile errors.

---

## 7. Optional: custom domain

If you own a domain on Cloudflare (e.g. `stormpath.app`):

1. Uncomment the `[[routes]]` block in `cloudflare/tomorrow-io-tiles/wrangler.toml`.
2. `npm run deploy` again.
3. Set `VITE_TOMORROW_IO_TILE_PROXY_URL=https://tiles.stormpath.app/tomorrow-io-tile`.

---

## Operations

| Task | Command |
|------|---------|
| Live logs | `npm run tail` (in `cloudflare/tomorrow-io-tiles`) |
| Redeploy after code change | `npm run deploy` |
| Rotate TIO key | `npx wrangler secret put TOMORROW_IO_API_KEY` |

**Cache:** successful tiles use `Cache-Control: public, max-age=300` (5 minutes), matching radar frame granularity.

**Cost:** Workers free tier includes large request volumes; most tile hits should be **edge cache hits** after the first user in a region loads a frame.

---

## Migration from Netlify-only

1. Deploy Cloudflare worker (steps above).
2. Set `VITE_TOMORROW_IO_TILE_PROXY_URL` and ship a new TestFlight build.
3. Keep Netlify `tomorrow-io-tile` deployed as fallback until you are confident.
4. Monitor Tomorrow.io API usage in their dashboard — caching reduces duplicate upstream calls but animation still uses many unique timestamps over time.

Code: `cloudflare/tomorrow-io-tiles/src/index.ts` (mirrors `web/netlify/functions/tomorrow-io-tile.ts`).
