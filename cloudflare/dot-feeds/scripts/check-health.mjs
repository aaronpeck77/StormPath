/**
 * Post-push health gate for the DOT feeds pipeline. Runs in GitHub Actions
 * right after push-snapshot.mjs — a nonzero exit fails the workflow, which
 * emails the repo owner. That email IS the alert: no new infra needed.
 *
 * Alerts on:
 *   - snapshot stale (>20 min — ingest path broken)
 *   - event count collapse (<8k vs ~17k baseline — mass feed failure)
 *   - state coverage collapse (<20 vs ~28 baseline)
 *   - feed failures NOT in KNOWN_FAILURES (new breakage)
 *
 * KNOWN_FAILURES = feeds already broken for known reasons; remove entries
 * when fixed so their recovery/re-breakage is visible again.
 *
 * Env: DOT_FEED_INGEST_URL (worker base URL)
 */
const url = process.env.DOT_FEED_INGEST_URL?.replace(/\/+$/, "");
if (!url) {
  console.error("DOT_FEED_INGEST_URL is required");
  process.exit(1);
}

const KNOWN_FAILURES = new Set(["fldot", "nysdot"]);
const MIN_EVENTS = 8_000;
const MIN_STATES = 20;
const MAX_AGE_SEC = 1_200;

const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(15_000) });
if (!res.ok) {
  console.error(`health check failed: HTTP ${res.status}`);
  process.exit(1);
}
const h = await res.json();

const problems = [];
if (typeof h.ageSec === "number" && h.ageSec > MAX_AGE_SEC)
  problems.push(`snapshot is ${h.ageSec}s old (>${MAX_AGE_SEC}s)`);
if (typeof h.events === "number" && h.events < MIN_EVENTS)
  problems.push(`only ${h.events} events (floor ${MIN_EVENTS})`);
if (typeof h.states === "number" && h.states < MIN_STATES)
  problems.push(`only ${h.states} states covered (floor ${MIN_STATES})`);

const failed = Array.isArray(h.feedsFailed) ? h.feedsFailed : [];
/* streak >= 2 means the feed failed two consecutive 12-min snapshots —
 * sustained, not a hiccup. KNOWN_FAILURES covers feeds broken for known
 * reasons (too-large payload, upstream HTML) until they're fixed. */
const unexpected = failed.filter(
  (f) => !KNOWN_FAILURES.has(f.name) && (f.streak ?? 1) >= 2
);
const transient = failed.filter(
  (f) => !KNOWN_FAILURES.has(f.name) && (f.streak ?? 1) < 2
);
if (unexpected.length)
  problems.push(
    `new feed failures: ${unexpected.map((f) => `${f.name} (${f.error})`).join(", ")}`
  );

if (transient.length)
  console.log(
    `transient (not alerting): ${transient.map((f) => f.name).join(", ")}`
  );

if (problems.length) {
  console.error("DOT feeds health gate FAILED:");
  for (const p of problems) console.error(`  - ${p}`);
  console.error(`full health: ${JSON.stringify(h)}`);
  process.exit(1);
}

console.log(
  `health ok: ${h.events} events, ${h.states} states, ` +
    `${h.feedsOk ?? "?"}/${h.feedsTotal ?? "?"} feeds ok` +
    (failed.length ? `, known failures: ${failed.map((f) => f.name).join(", ")}` : "")
);
