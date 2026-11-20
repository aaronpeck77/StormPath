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

/* The Worker occasionally returns edge 5xx (1101 crashes, cold-start OOMs)
 * that clear on retry — a single transient shouldn't red the whole run. */
const body = JSON.stringify(snap);
let res = null;
let text = "";
for (let attempt = 1; attempt <= 3; attempt++) {
  res = await fetch(`${url}/ingest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body,
  });
  text = await res.text();
  if (res.ok) break;
  if (res.status < 500 || attempt === 3) {
    console.error(`ingest failed: ${res.status} ${text}`);
    process.exit(1);
  }
  console.warn(`ingest attempt ${attempt} got ${res.status} — retrying`);
  await new Promise((r) => setTimeout(r, attempt * 5000));
}
console.log(`snapshot pushed: ${snap.events.length} events, ${snap.states.length} states covered`);
