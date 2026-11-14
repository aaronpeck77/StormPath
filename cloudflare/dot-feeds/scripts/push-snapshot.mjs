/**
 * Builds the DOT snapshot with the same code the Worker runs, then POSTs it
 * to the Worker's /ingest endpoint. Runs in GitHub Actions — no CPU cap.
 *
 * Env:
 *   DOT_FEED_INGEST_URL     worker base URL (e.g. https://stormpath-dot-feeds.<sub>.workers.dev)
 *   DOT_FEED_INGEST_SECRET  bearer secret matching the Worker's INGEST_SECRET
 *   <FEED_KEY_SECRETS>       optional keyed-feed API keys (TXDOT_API_KEY, …)
 *
 * Usage: node scripts/push-snapshot.mjs [path-to-bundled-index.mjs]
 * The bundle is produced by: npx esbuild src/index.ts --bundle --format=esm --platform=node --outfile=.build/index.mjs
 */
import { buildSnapshot } from "../.build/index.mjs";

const url = process.env.DOT_FEED_INGEST_URL?.replace(/\/+$/, "");
const secret = process.env.DOT_FEED_INGEST_SECRET;
if (!url || !secret) {
  console.error("DOT_FEED_INGEST_URL and DOT_FEED_INGEST_SECRET are required");
  process.exit(1);
}

const snap = await buildSnapshot(process.env);
const res = await fetch(`${url}/ingest`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${secret}`,
  },
  body: JSON.stringify(snap),
});
const text = await res.text();
if (!res.ok) {
  console.error(`ingest failed: ${res.status} ${text}`);
  process.exit(1);
}
console.log(`snapshot pushed: ${snap.events.length} events, ${snap.states.length} states covered`);
