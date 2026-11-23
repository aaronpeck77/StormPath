# stormpath-social-x

Posts tweets to the StormPath X account through a Cloudflare Worker.
No libraries — OAuth 1.0a signing is hand-rolled on WebCrypto (~40 lines).

## One-time setup (your clicks — ~15 min)

1. **Create the X account** first (x.com) — e.g. @StormPathApp. Pick a handle,
   upload the app icon, write a one-line bio. Do this before the developer
   part — the developer account attaches to it.
2. Go to **developer.x.com** → sign in with the new account → **Sign up for
   a developer account**. The **Free** tier is enough (write-only posting).
   Fill the use-case honestly ("posting weather/route updates for my app").
3. In the developer portal: **Projects & Apps → your app → Settings →
   User authentication settings** → set **App permissions = Read and write**,
   type = **Web App / Native**. Save.
4. Same app → **Keys and tokens**:
   - Copy **API Key** and **API Key Secret**
   - Click **Generate** under **Access Token and Secret** — IMPORTANT: generate
     these AFTER setting Read+Write, or they'll carry read-only permissions
     and posting 403s.
5. Set the worker secrets:

   ```bash
   cd cloudflare/social-x
   npx wrangler secret put X_API_KEY
   npx wrangler secret put X_API_SECRET
   npx wrangler secret put X_ACCESS_TOKEN
   npx wrangler secret put X_ACCESS_SECRET
   npx wrangler secret put SOCIAL_POST_KEY   # any long random string — locks the /post endpoint
   ```

## Deploy & test

```bash
npm install
npx wrangler deploy
curl https://stormpath-social-x.<subdomain>.workers.dev/health
# → {"ok":true,"configured":true}

curl -X POST https://stormpath-social-x.<subdomain>.workers.dev/post \
  -H "x-social-key: $SOCIAL_POST_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text":"StormPath is live — weather + hazard awareness for your whole route."}'
# → {"data":{"id":"...","text":"..."}} on success
```

## Notes

- Free tier is fine for launch (~1,500 posts/mo, app-level). If it ever
  rate-limits, `/post` returns X's 429 body verbatim.
- Text-only for now. Photo/Reel posts need the v1.1 media-upload chunked
  flow — add when the first content template needs it.
- Later: a `/storm-post` endpoint that formats radar/corridor data into a
  tweet automatically, plus Cron Triggers for scheduled posts.
