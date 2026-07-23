# StormPath home-api (Forge)

Small Node server for the spare Windows PC (`forge`). Runs WeatherKit token minting, Control Room `ops-summary`, and static legal/ops pages — same behavior as the Netlify functions, without Netlify credits.

**Do not point TestFlight / production app URLs here until Cloudflare Tunnel is stable.** Netlify stays live until cutover.

## Roles

| Machine | Job |
|---------|-----|
| Your usual PC | Edit StormPath, push to GitHub |
| Forge | `git pull`, run this server |

## First-time setup (Forge PowerShell)

```powershell
cd "C:\My Apps\StormPath"
git pull
cd web\home-api
copy .env.example .env
notepad .env
npm install
npm start
```

Fill `.env` with the same `WEATHERKIT_*` / `OPS_HUB_SECRET` / optional RevenueCat values you use on Netlify.

Or double-click `start.bat`.

## Local checks

With the server running:

- http://127.0.0.1:8787/health
- http://127.0.0.1:8787/weatherkit-token (needs WeatherKit env)
- http://127.0.0.1:8787/ops/ (Control Room; unlock with `OPS_HUB_SECRET`)

Optional multi-app aliases: `/stormpath/weatherkit-token`, `/stormpath/ops/`.

## Always-on (Windows)

1. Settings → System → Power → when plugged in, **sleep = Never**
2. Prefer Ethernet
3. Task Scheduler (later): run `start.bat` or `npm start` at logon
4. Keep a Cloudflare Tunnel pointed at `http://127.0.0.1:8787` (install `cloudflared` when ready)

## Cloudflare Tunnel (after local works)

Keep `npm start` running in one window. Tunnel in a **second** window.

### A. Quick test tunnel (tonight — URL changes each run)

1. Install cloudflared (winget):

```powershell
winget install --id Cloudflare.cloudflared -e
```

Close and reopen PowerShell, then:

```powershell
cloudflared tunnel --url http://127.0.0.1:8787
```

2. Copy the `https://….trycloudflare.com` URL it prints.
3. On your **phone** (not Forge): open `https://THAT-URL/health`
4. Then try `https://THAT-URL/weatherkit-token`

Do **not** bake trycloudflare URLs into TestFlight — they change when you restart.

### B. Named tunnel (stable — before app cutover)

1. Cloudflare account at [dash.cloudflare.com](https://dash.cloudflare.com)
2. `cloudflared tunnel login` (browser approve)
3. `cloudflared tunnel create home-api`
4. Config file pointing hostname → `http://127.0.0.1:8787`
5. `cloudflared tunnel run home-api`

Only after a **stable** hostname works from your phone: change TestFlight `VITE_WEATHERKIT_TOKEN_URL` (separate step).

## Secrets

- `.env` is gitignored — never commit it
- Copy values from Netlify → Site configuration → Environment variables
