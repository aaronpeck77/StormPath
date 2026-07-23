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

async function netlifyDeploy(): Promise<{
  configured: boolean;
  state?: string;
  createdAt?: string;
  commitRef?: string;
  error?: string;
}> {
  const token = process.env.NETLIFY_AUTH_TOKEN?.trim();
  const siteId = process.env.NETLIFY_SITE_ID?.trim();
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

  const siteUrl = (
    process.env.SITE_URL?.trim() || "https://stormpath2.netlify.app"
  ).replace(/\/$/, "");
  const tileProxy = process.env.TOMORROW_IO_TILE_PROXY_URL?.trim().replace(
    /\/$/,
    ""
  );

  const [web, weatherkit, nws, rainviewer, tileWorker, income, deploy, sentry, ios] =
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
      mapboxUsage: await buildMapboxUsageSummary(),
      mapboxNote:
        "Mapbox has no public Statistics API. StormPath counts its own Directions / Geocoding / Matching / Search Box / Nav trips into mapboxUsage. Map loads/tiles still require account.mapbox.com. Optional paste ledger reconciles against the dashboard.",
      jeffFixes: await buildJeffFixSummary(),
    }),
  };
};
