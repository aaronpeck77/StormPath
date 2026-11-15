# Crash reporting (Sentry)

StormPath sends **JavaScript errors** (React crashes, unhandled promise rejections) to [Sentry](https://sentry.io) when a DSN is baked into the build.

Native iOS crashes outside the WebView are **not** covered unless you add `@sentry/capacitor` later.

## One-time setup (about 10 minutes)

1. Create a free account at [sentry.io](https://sentry.io).
2. **Create project** → platform **React** → name e.g. `stormpath-ios`.
3. Copy the **DSN** (looks like `https://xxxx@o123.ingest.us.sentry.io/456`).
4. **GitHub** → repo **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:
   - Name: `VITE_SENTRY_DSN`
   - Value: paste the DSN
5. (Optional) Add the same line to `web/.env.local` for local test builds:
   ```
   VITE_SENTRY_DSN=https://...
   ```
6. Push to `master` — the iOS workflow passes the secret into `npm run build:testflight`.

If the secret is **missing**, the app still works; crash reporting is simply off.

## Sourcemaps (readable stack traces)

Production builds emit **hidden sourcemaps** and the iOS workflow uploads them
to Sentry with injected debug IDs before `cap sync`. Without this, every frame
in a crash report is minified (`e.layout.get`).

One-time setup:

1. Sentry → **Settings → Auth Tokens** → create a token with scope
   `project:releases` (or `org:read` + `project:read`/`project:write`).
2. GitHub repo → **Settings → Secrets and variables → Actions**:
   - `SENTRY_AUTH_TOKEN` — the token above (required to enable upload)
   - `SENTRY_ORG` — optional, defaults to `stormpath`
   - `SENTRY_PROJECT` — optional, defaults to `apple-ios` (the real project
     slug); only set this if the project is ever recreated under a new slug
3. Next iOS build uploads automatically. The step is warn-only — a bad slug
   logs a warning but never blocks TestFlight.

## Verify

1. Install a TestFlight build that was built **after** the secret was added.
2. In Sentry → **Issues**, you should see events when something throws (or use a deliberate test in dev with DSN in `.env.local`).

## Privacy

- No email or destination text is attached automatically.
- Events include app version, build mode (`testflight` / `production`), and platform (`ios` / `web`).
- Tell testers in **What to Test**: serious crashes may be reported automatically; they should still use Support diagnostics for feedback.

## Related

- Code: `web/src/monitoring/sentry.ts`
- Workflow env: `.github/workflows/ios-build.yml`
- Field / dead-zone supervisor (planned): [`FIELD_RESILIENCE_SUPERVISOR.md`](FIELD_RESILIENCE_SUPERVISOR.md), Sentry → PR automation: [`CURSOR_AUTOMATION_FIELD_REPORTS.md`](CURSOR_AUTOMATION_FIELD_REPORTS.md)
