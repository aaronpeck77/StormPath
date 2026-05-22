# Dev and TestFlight — same code, mirrored behavior

There is **one** StormPath codebase. **Local dev** is where you verify changes before Git; **TestFlight** is the same tree after you push, built as a production bundle inside Capacitor.

## Pipeline (your intent)

1. **Develop** — `cd web && npm run dev` on Windows (browser). Tier defaults to **Plus** in dev.
2. **Commit & push to GitHub** (`master` or `main`) — when you are happy with the change set.
3. **TestFlight binary** — **GitHub Actions** builds and uploads (no Mac required). See [`GITHUB_TESTFLIGHT_ONLY.md`](GITHUB_TESTFLIGHT_ONLY.md). Optional: rented Mac + Xcode archive instead of Actions.

That install should **mirror** what you tested, including **Plus** on internal TestFlight builds.

## Mirroring Plus between dev and TestFlight

| Environment | Command / build | Plus? |
|-------------|-------------------|--------|
| Local dev | `npm run dev` | **Yes** (Vite `import.meta.env.DEV`) |
| TestFlight / internal QA IPA | `npm run build:testflight` (or `npm run build:ios:testflight`) | **Yes** — loads committed `web/.env.testflight` which sets `VITE_PAY_TIER=plus` |
| App Store **customer** release | `npm run build` (not `--mode testflight`) | **Basic** unless you add real IAP / entitlement or a deliberate retail env |

So: **use `build:testflight` for the IPAs you install from TestFlight while the app is still in active development**, so you are not stuck on Basic there. When you ship a **public** customer build, use plain `npm run build` (no `VITE_PAY_TIER=plus` in that env).

`web/.env.testflight` is **committed** (no secrets). Tokens and keys stay in your gitignored `.env` / `.env.local`; Vite merges them with `.env.testflight` at build time.

## Commands

```bash
cd web
npm run dev                    # local development
npm run build:ios:testflight   # bundle + sync iOS — then archive in Xcode for TestFlight
npm run build:ios              # retail-shaped bundle (Basic) + sync — App Store track when ready
```

## When you change something

- **Code / assets** — edit locally → `npm run dev` → commit → push → rebuild iOS with **`build:ios:testflight`** so TestFlight matches the commit you pushed.
- **Env-only change** (new `VITE_*`) — add to **both** `.env.local` (dev) and whatever supplies env for your **TestFlight** archive (often the same machine: `.env.local` is picked up by `vite build` too). If the new flag must differ between dev and TestFlight, use `web/.env.testflight` for testflight-only overrides.

## Related

- `docs/BETA_READINESS.md` — pre-invite checklist (keys, build, smoke, TestFlight copy).
- `docs/TESTER_NOTES.md` — smoke items + text for testers.
- `docs/MOBILE_STORE_RELEASE.md` — store review, IAP placeholder, QA entitlement keys.
- `docs/PAY_TIERS.md` — what Basic vs Plus includes.
