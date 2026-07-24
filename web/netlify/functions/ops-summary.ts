/**
 * StormPath Control Room aggregator.
 *
 * Locked behind OPS_HUB_SECRET (Bearer token). Optional env:
 *   REVENUECAT_SECRET_API_KEY + REVENUECAT_PROJECT_ID
 *   NETLIFY_AUTH_TOKEN + NETLIFY_SITE_ID
 *   SENTRY_AUTH_TOKEN + SENTRY_ORG + SENTRY_PROJECT
 *   TOMORROW_IO_TILE_PROXY_URL (Workers health)
 *   SITE_URL (defaults to https://stormpath2.netlify.app)
 *   OPS_USAGE_INGEST_TOKEN — write-only token apps use to report Mapbox usage
 */

import { buildMapboxUsageSummary } from "./_mapboxUsageStore.ts";
import { buildJeffFixSummary } from "./_jeffFixLogStore.ts";
import { connectBlobsIfLambda } from "./_blobsLambda.ts";
import {
  NETLIFY_FREE_CREDITS,
  readNetlifyCredits,
} from "./_netlifyCreditsStore.ts";

type NetlifyEvent = {
  httpMethod: string;
  headers?: Record<string, string | undefined>;
  queryStringParameters?: Record<string, string | undefined> | null;
};

type Probe = {
  id: string;
  label: string;
  ok: boolean;
  status?: number;
  ms: number;
  detail?: string;
};

type Metric = {
  id: string;
  name: string;
  value: number | string | null;
  unit?: string;
  detail?: string;
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json",
  "Cache-Control": "private, max-age=60",
};

function header(
  event: NetlifyEvent,
  name: string
): string | undefined {
  const h = event.headers ?? {};
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(h)) {
    if (k.toLowerCase() === want) return v;
  }
  return undefined;
}

function authorized(event: NetlifyEvent): boolean {
  const secret = process.env.OPS_HUB_SECRET?.trim();
  if (!secret) return false;
  const auth = header(event, "authorization") ?? "";
  if (auth === `Bearer ${secret}`) return true;
  const q = event.queryStringParameters?.key?.trim();
  return Boolean(q && q === secret);
}

async function probe(
  id: string,
  label: string,
  url: string,
  init?: RequestInit
): Promise<Probe> {
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(12_000),
    });
    const ms = Date.now() - t0;
    return {
      id,
      label,
      ok: res.ok,
      status: res.status,
      ms,
      detail: res.ok ? undefined : `HTTP ${res.status}`,
    };
  } catch (e) {
    return {
      id,
      label,
      ok: false,
      ms: Date.now() - t0,
      detail: e instanceof Error ? e.message : "fetch failed",
    };
  }
}

async function revenueCatMetrics(): Promise<{
  configured: boolean;
  metrics: Metric[];
  error?: string;
}> {
  const key = process.env.REVENUECAT_SECRET_API_KEY?.trim();
  const projectId = process.env.REVENUECAT_PROJECT_ID?.trim();
  if (!key || !projectId) {
    return { configured: false, metrics: [] };
  }
  try {
    const res = await fetch(
      `https://api.revenuecat.com/v2/projects/${encodeURIComponent(projectId)}/metrics/overview?currency=USD`,
      {
        headers: {
          Authorization: `Bearer ${key}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(15_000),
      }
    );
    if (!res.ok) {
      return {
        configured: true,
        metrics: [],
        error: `RevenueCat HTTP ${res.status}`,
      };
    }
    const body = (await res.json()) as {
      metrics?: Array<{
        id?: string;
        name?: string;
        value?: number;
        unit?: string;
        description?: string;
      }>;
    };
    const want = new Set([
      "mrr",
      "active_subscriptions",
      "active_trials",
      "active_users",
      "new_customers",
      "revenue",
    ]);
    const metrics: Metric[] = (body.metrics ?? [])
      .filter((m) => m.id && want.has(m.id))
      .map((m) => ({
        id: m.id!,
        name: m.name ?? m.id!,
        value: m.value ?? null,
        unit: m.unit,
        detail: m.description,
      }));
    return { configured: true, metrics };
  } catch (e) {
    return {
      configured: true,
      metrics: [],
      error: e instanceof Error ? e.message : "RevenueCat failed",
    };
  }
}

type NetlifyBandwidthUsage = {
  usedBytes: number;
  includedBytes: number;
  periodStart?: string;
  periodEnd?: string;
};

type NetlifyCreditsUsage = {
  remaining: number;
  included: number;
  used: number;
  setAt: string | null;
  source: "manual" | "unset";
};

type NetlifyBuildUsage = {
  minutesUsed: number;
  minutesIncluded: number;
  buildCount?: number;
  periodStart?: string;
  periodEnd?: string;
};

function netlifyAuthToken(): string {
  // Personal access token — must be a site/team env var whose scope includes Functions
  // (Builds-only scope is invisible to ops-summary at runtime).
  return (
    process.env.NETLIFY_AUTH_TOKEN?.trim() ||
    process.env.NETLIFY_TOKEN?.trim() ||
    ""
  );
}

function netlifySiteId(): string {
  // Prefer the explicit ops var; fall back to Netlify's built-in SITE_ID (always available
  // to Functions for the site that's running the function — no need to paste it by hand).
  return process.env.NETLIFY_SITE_ID?.trim() || process.env.SITE_ID?.trim() || "";
}

/** Netlify returns period dates as unix seconds, unix ms, or ISO strings depending on endpoint. */
function parseNetlifyDate(raw: unknown): string | undefined {
  if (raw == null || raw === "") return undefined;
  try {
    let d: Date;
    if (typeof raw === "number" && Number.isFinite(raw)) {
      // Seconds vs milliseconds: < 1e12 ≈ before year ~2001 in ms, so treat as seconds.
      d = new Date(raw < 1e12 ? raw * 1000 : raw);
    } else if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (/^\d+(\.\d+)?$/.test(trimmed)) {
        const n = Number(trimmed);
        d = new Date(n < 1e12 ? n * 1000 : n);
      } else {
        d = new Date(trimmed);
      }
    } else {
      return undefined;
    }
    if (Number.isNaN(d.getTime())) return undefined;
    return d.toISOString();
  } catch {
    return undefined;
  }
}

/**
 * Netlify's account-level usage (bandwidth, build minutes) so we can watch for a burn-through
 * without opening the Netlify dashboard by hand. `builds/status` is in Netlify's official
 * open-api spec (stable). The bandwidth endpoint is NOT documented anywhere by Netlify — it's
 * the same call their own dashboard makes, reverse-engineered by the community — so it's called
 * defensively and can simply stop returning data if Netlify ever changes it, without breaking
 * anything else here.
 */
async function netlifyUsage(): Promise<{
  configured: boolean;
  accountSlug?: string;
  bandwidth?: NetlifyBandwidthUsage;
  builds?: NetlifyBuildUsage;
  credits?: NetlifyCreditsUsage;
  missing?: string[];
  error?: string;
}> {
  const token = netlifyAuthToken();
  const siteId = netlifySiteId();
  const creditSnap = await readNetlifyCredits();
  const credits: NetlifyCreditsUsage = creditSnap
    ? {
        remaining: creditSnap.remaining,
        included: creditSnap.included,
        used: Math.max(0, creditSnap.included - creditSnap.remaining),
        setAt: creditSnap.setAt,
        source: "manual",
      }
    : {
        remaining: NETLIFY_FREE_CREDITS,
        included: NETLIFY_FREE_CREDITS,
        used: 0,
        setAt: null,
        source: "unset",
      };

  if (!token || !siteId) {
    const missing: string[] = [];
    if (!token) missing.push("NETLIFY_AUTH_TOKEN");
    if (!siteId) missing.push("NETLIFY_SITE_ID (or built-in SITE_ID)");
    return { configured: false, missing, credits };
  }
  try {
    const siteRes = await fetch(
      `https://api.netlify.com/api/v1/sites/${encodeURIComponent(siteId)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(12_000),
      }
    );
    if (!siteRes.ok) {
      return {
        configured: true,
        credits,
        error:
          siteRes.status === 401 || siteRes.status === 403
            ? `Netlify rejected the auth token (HTTP ${siteRes.status}) — regenerate the personal access token and update NETLIFY_AUTH_TOKEN`
            : `Netlify site lookup HTTP ${siteRes.status}`,
      };
    }
    const site = (await siteRes.json()) as { account_slug?: string };
    const slug = site.account_slug;
    if (!slug) {
      return { configured: true, credits, error: "Netlify site has no account_slug" };
    }

    const authHeaders = { Authorization: `Bearer ${token}` };
    // Bandwidth path isn't officially documented — Netlify's UI and community tools have used
    // both `/accounts/{slug}/bandwidth` and `/{slug}/bandwidth`. Try both.
    const [bwResAccounts, bwResSlug, buildRes] = await Promise.all([
      fetch(`https://api.netlify.com/api/v1/accounts/${encodeURIComponent(slug)}/bandwidth`, {
        headers: authHeaders,
        signal: AbortSignal.timeout(12_000),
      }).catch(() => null),
      fetch(`https://api.netlify.com/api/v1/${encodeURIComponent(slug)}/bandwidth`, {
        headers: authHeaders,
        signal: AbortSignal.timeout(12_000),
      }).catch(() => null),
      fetch(`https://api.netlify.com/api/v1/${encodeURIComponent(slug)}/builds/status`, {
        headers: authHeaders,
        signal: AbortSignal.timeout(12_000),
      }).catch(() => null),
    ]);
    const bwRes = bwResAccounts?.ok ? bwResAccounts : bwResSlug?.ok ? bwResSlug : bwResAccounts;

    let bandwidth: NetlifyBandwidthUsage | undefined;
    if (bwRes?.ok) {
      const b = (await bwRes.json().catch(() => null)) as {
        used?: number;
        included?: number;
        period_start_date?: number | string;
        period_end_date?: number | string;
      } | null;
      if (b) {
        bandwidth = {
          usedBytes: Number(b.used) || 0,
          includedBytes: Number(b.included) || 0,
          periodStart: parseNetlifyDate(b.period_start_date),
          periodEnd: parseNetlifyDate(b.period_end_date),
        };
      }
    }

    let builds: NetlifyBuildUsage | undefined;
    if (buildRes?.ok) {
      // Official OpenAPI marks this response as an *array* of buildStatus objects.
      const raw = await buildRes.json().catch(() => null);
      const bs = (Array.isArray(raw) ? raw[0] : raw) as {
        build_count?: number;
        minutes?: {
          current?: number;
          included_minutes?: string;
          included_minutes_with_packs?: string;
          period_start_date?: string | number;
          period_end_date?: string | number;
        };
      } | null;
      if (bs) {
        const included = Number(
          bs.minutes?.included_minutes_with_packs || bs.minutes?.included_minutes || 0
        );
        builds = {
          minutesUsed: Number(bs.minutes?.current) || 0,
          minutesIncluded: Number.isFinite(included) ? included : 0,
          buildCount: bs.build_count,
          periodStart: parseNetlifyDate(bs.minutes?.period_start_date),
          periodEnd: parseNetlifyDate(bs.minutes?.period_end_date),
        };
      }
    }

    const bwStatus = bwRes?.status;
    return {
      configured: true,
      accountSlug: slug,
      bandwidth,
      // Legacy build-minutes kept in the payload for debugging, but Control Room no longer
      // surfaces them — credit-based plans (Free/Personal/Pro) bill by credits, not minutes.
      builds,
      credits,
      error: !bandwidth
        ? `Bandwidth endpoint returned nothing (HTTP ${bwStatus ?? "n/a"})`
        : undefined,
    };
  } catch (e) {
    return {
      configured: true,
      credits,
      error: e instanceof Error ? e.message : "Netlify usage failed",
    };
  }
}

async function netlifyDeploy(): Promise<{
  configured: boolean;
  state?: string;
  createdAt?: string;
  commitRef?: string;
  error?: string;
}> {
  const token = netlifyAuthToken();
  const siteId = netlifySiteId();
  if (!token || !siteId) return { configured: false };
  try {
    const res = await fetch(
      `https://api.netlify.com/api/v1/sites/${encodeURIComponent(siteId)}/deploys?per_page=1`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(12_000),
      }
    );
    if (!res.ok) {
      return { configured: true, error: `Netlify HTTP ${res.status}` };
    }
    const list = (await res.json()) as Array<{
      state?: string;
      created_at?: string;
      commit_ref?: string;
    }>;
    const d = list[0];
    return {
      configured: true,
      state: d?.state,
      createdAt: d?.created_at,
      commitRef: d?.commit_ref?.slice(0, 7),
    };
  } catch (e) {
    return {
      configured: true,
      error: e instanceof Error ? e.message : "Netlify failed",
    };
  }
}

async function sentryOpenIssues(): Promise<{
  configured: boolean;
  count?: number;
  error?: string;
}> {
  const token = process.env.SENTRY_AUTH_TOKEN?.trim();
  const org = process.env.SENTRY_ORG?.trim();
  const project = process.env.SENTRY_PROJECT?.trim();
  if (!token || !org || !project) return { configured: false };
  try {
    const url = new URL(
      `https://sentry.io/api/0/projects/${encodeURIComponent(org)}/${encodeURIComponent(project)}/issues/`
    );
    url.searchParams.set("query", "is:unresolved");
    url.searchParams.set("statsPeriod", "14d");
    url.searchParams.set("limit", "1");
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      return { configured: true, error: `Sentry HTTP ${res.status}` };
    }
    const hits = res.headers.get("X-Hits") ?? res.headers.get("x-hits");
    const count = hits ? Number(hits) : ((await res.json()) as unknown[]).length;
    return { configured: true, count: Number.isFinite(count) ? count : undefined };
  } catch (e) {
    return {
      configured: true,
      error: e instanceof Error ? e.message : "Sentry failed",
    };
  }
}

async function iosBuild(): Promise<{
  conclusion?: string | null;
  status?: string;
  createdAt?: string;
  htmlUrl?: string;
  headSha?: string;
  error?: string;
}> {
  try {
    const res = await fetch(
      "https://api.github.com/repos/aaronpeck77/StormPath/actions/workflows/ios-build.yml/runs?per_page=1",
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "StormPath-OpsHub",
        },
        signal: AbortSignal.timeout(12_000),
      }
    );
    if (!res.ok) return { error: `GitHub HTTP ${res.status}` };
    const body = (await res.json()) as {
      workflow_runs?: Array<{
        conclusion: string | null;
        status: string;
        created_at: string;
        html_url: string;
        head_sha: string;
      }>;
    };
    const run = body.workflow_runs?.[0];
    if (!run) return { error: "No iOS runs" };
    return {
      conclusion: run.conclusion,
      status: run.status,
      createdAt: run.created_at,
      htmlUrl: run.html_url,
      headSha: run.head_sha.slice(0, 7),
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "GitHub failed" };
  }
}

export const handler = async (event: NetlifyEvent) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }
  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: CORS,
      body: JSON.stringify({ error: "GET only" }),
    };
  }
  if (!process.env.OPS_HUB_SECRET?.trim()) {
    return {
      statusCode: 503,
      headers: CORS,
      body: JSON.stringify({
        error: "OPS_HUB_SECRET not set on Netlify",
        hint: "Add OPS_HUB_SECRET in Netlify → Site configuration → Environment variables",
      }),
    };
  }
  if (!authorized(event)) {
    return {
      statusCode: 401,
      headers: CORS,
      body: JSON.stringify({ error: "Unauthorized" }),
    };
  }

  await connectBlobsIfLambda(event);

  const siteUrl = (
    process.env.SITE_URL?.trim() || "https://stormpath2.netlify.app"
  ).replace(/\/$/, "");
  const tileProxy = process.env.TOMORROW_IO_TILE_PROXY_URL?.trim().replace(
    /\/$/,
    ""
  );

  const [web, weatherkit, nws, rainviewer, tileWorker, income, deploy, sentry, ios, netlify] =
    await Promise.all([
      probe("web", "Netlify site", `${siteUrl}/`),
      probe(
        "weatherkit",
        "WeatherKit token fn",
        `${siteUrl}/.netlify/functions/weatherkit-token`
      ),
      probe("nws", "NWS alerts API", "https://api.weather.gov/alerts/active?status=actual", {
        headers: { "User-Agent": "StormPathOps/1.0 (ops-hub)", Accept: "application/geo+json" },
      }),
      probe(
        "rainviewer",
        "RainViewer maps JSON",
        "https://api.rainviewer.com/public/weather-maps.json"
      ),
      tileProxy
        ? probe("tiles", "Tomorrow tile worker", `${tileProxy}/health`)
        : Promise.resolve({
            id: "tiles",
            label: "Tomorrow tile worker",
            ok: false,
            ms: 0,
            detail: "TOMORROW_IO_TILE_PROXY_URL not set",
          } satisfies Probe),
      revenueCatMetrics(),
      netlifyDeploy(),
      sentryOpenIssues(),
      iosBuild(),
      netlifyUsage(),
    ]);

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({
      generatedAt: new Date().toISOString(),
      siteUrl,
      health: [web, weatherkit, nws, rainviewer, tileWorker],
      income,
      deploy,
      sentry,
      ios,
      netlifyUsage: netlify,
      mapboxUsage: await buildMapboxUsageSummary(),
      mapboxNote:
        "Mapbox has no public Statistics API. StormPath counts its own Directions / Geocoding / Matching / Search Box / Nav trips / Map loads into mapboxUsage — no manual reconciliation needed.",
      jeffFixes: await buildJeffFixSummary(),
    }),
  };
};
