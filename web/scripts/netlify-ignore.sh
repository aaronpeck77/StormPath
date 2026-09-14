#!/usr/bin/env bash
# Netlify ignore command (cwd = site base `web/`).
# Exit 0 = skip build (save credits). Exit 1 = proceed.
#
# TestFlight / native Drive work ships JS via GitHub Actions — not Netlify.
# Only rebuild when the public site, serverless functions, or Netlify config change.

set -euo pipefail

# Branch / PR previews: never burn minutes for native/drive experiments.
if [ "${CONTEXT:-}" = "branch-deploy" ] || [ "${CONTEXT:-}" = "deploy-preview" ]; then
  exit 0
fi

# Empty cache ref (first build) → always build.
if [ -z "${CACHED_COMMIT_REF:-}" ] || [ -z "${COMMIT_REF:-}" ]; then
  exit 1
fi

# Paths relative to `web/` (Netlify base). Add a path here when Netlify must pick it up.
# Do NOT list `src/` — Capacitor/TestFlight builds own that; Netlify SPA can lag until
# someone changes public/ or functions (or touches public/_netlify-force-deploy).
git diff --quiet "$CACHED_COMMIT_REF" "$COMMIT_REF" -- \
  netlify/ \
  public/ \
  package.json \
  package-lock.json \
  scripts/verify-netlify-dist.mjs \
  index.html \
  vite.config.ts \
  ../netlify.toml
