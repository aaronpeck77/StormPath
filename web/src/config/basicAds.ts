import type { getWebEnv } from "./env";

export type AdvisoryPromoLine = {
  id: string;
  text: string;
  /** Opens in a new tab when the row is a link. */
  href?: string;
  /** Shown in expanded strip / idle banner when set; falls back to `text`. */
  detailText?: string;
  /** Partner promos show a small “Sponsored” label in the idle banner. */
  sponsored?: boolean;
};

/** Shown in the expanded advisory and in the Basic promo rotation (set expectations before backend upgrades). */
export const ADVISORY_WEATHER_UPGRADES_COMING_SOON =
  "Weather data and reporting upgrades are coming soon.";

/** Collapsed bar preview; long copy scrolls horizontally in the advisory bar when it doesn’t fit. */
export const SITEBIBLE_AD_BAR =
  "Coming Soon - SiteBible - Digital Security Database - Check App Store";

type WebEnv = ReturnType<typeof getWebEnv>;

/** First-party partner slots — edit copy here; wire URLs via env (`VITE_SITEBIBLE_URL`, etc.). */
const BUILTIN_PARTNER_ADS: Array<{
  id: string;
  barText: string;
  detailText: string;
  href?: (env: WebEnv) => string | undefined;
  sponsored?: boolean;
}> = [
  {
    id: "sitebible",
    barText: SITEBIBLE_AD_BAR,
    detailText:
      "SiteBible — digital security database for campuses and congregations. Check the App Store.",
    href: (env) => env.siteBibleUrl || undefined,
    sponsored: true,
  },
];

type EnvAdOverride = {
  id: string;
  text: string;
  detailText?: string;
  href?: string;
  sponsored?: boolean;
};

function parseEnvBasicAdsJson(raw: string | undefined): EnvAdOverride[] {
  const trimmed = raw?.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: EnvAdOverride[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const id = typeof row.id === "string" ? row.id.trim() : "";
      const text = typeof row.text === "string" ? row.text.trim() : "";
      if (!id || !text) continue;
      out.push({
        id,
        text,
        detailText: typeof row.detailText === "string" ? row.detailText.trim() : undefined,
        href: typeof row.href === "string" ? row.href.trim() : undefined,
        sponsored: row.sponsored === true,
      });
    }
    return out;
  } catch {
    return [];
  }
}

function mergeEnvOverrides(lines: AdvisoryPromoLine[], overrides: EnvAdOverride[]): AdvisoryPromoLine[] {
  if (overrides.length === 0) return lines;
  const byId = new Map(lines.map((l) => [l.id, l]));
  for (const o of overrides) {
    const prev = byId.get(o.id);
    byId.set(o.id, {
      id: o.id,
      text: o.text,
      detailText: o.detailText ?? prev?.detailText,
      href: o.href ?? prev?.href,
      sponsored: o.sponsored ?? prev?.sponsored,
    });
  }
  return Array.from(byId.values());
}

function partnerLines(env: WebEnv): AdvisoryPromoLine[] {
  return BUILTIN_PARTNER_ADS.map((ad) => ({
    id: ad.id,
    text: ad.barText,
    detailText: ad.detailText,
    href: ad.href?.(env),
    sponsored: ad.sponsored,
  })).filter((ad) => ad.text.length > 0);
}

function plusUpsellLine(env: WebEnv, variant: "full" | "nav-radar"): AdvisoryPromoLine {
  const full =
    "StormPath Plus: full NWS map, traffic, and weather along your route.";
  const navRadar =
    "StormPath Plus adds live traffic, the full hazard map, and tools along your route.";
  const text = variant === "full" ? full : navRadar;
  if (env.upgradeUrl) {
    return { id: "sp-plus-upsell", text, detailText: text, href: env.upgradeUrl };
  }
  return { id: "sp-plus-upsell", text, detailText: text };
}

function connectivityTip(id: string): AdvisoryPromoLine {
  return {
    id,
    text: "Tip: routes and map tiles load faster on Wi‑Fi or stronger cell signal.",
    detailText:
      "Tip: map tiles and route data load faster on Wi‑Fi or stronger cell signal.",
  };
}

/**
 * Rotating copy in the advisory strip — weather line, SiteBible, optional Plus upsell (Basic only), tips.
 * Edit defaults in `basicAds.ts` or set `VITE_BASIC_ADS_JSON` / `VITE_SITEBIBLE_URL` / `VITE_UPGRADE_URL`.
 */
export function buildAdvisoryPromoLines(env: WebEnv, ownsPlus: boolean): AdvisoryPromoLine[] {
  const lines: AdvisoryPromoLine[] = [
    { id: "sp-weather-upgrades-soon", text: ADVISORY_WEATHER_UPGRADES_COMING_SOON },
    ...partnerLines(env),
  ];

  if (!ownsPlus) lines.push(plusUpsellLine(env, "full"));
  lines.push(connectivityTip("tip-net"));

  return mergeEnvOverrides(lines, parseEnvBasicAdsJson(env.basicAdsJson));
}

/** Basic tier: navigation + radar only — no weather-upgrade or NWS-oriented promo copy. */
export function buildBasicNavAdvisoryPromoLines(env: WebEnv): AdvisoryPromoLine[] {
  const lines: AdvisoryPromoLine[] = [...partnerLines(env), plusUpsellLine(env, "nav-radar"), connectivityTip("tip-net-basic")];
  return mergeEnvOverrides(lines, parseEnvBasicAdsJson(env.basicAdsJson));
}

/** Idle banner + expanded strip: partner promos and Plus upsell (no generic tips). */
export function buildBasicDisplayAdLines(env: WebEnv): AdvisoryPromoLine[] {
  const lines: AdvisoryPromoLine[] = [...partnerLines(env), plusUpsellLine(env, "nav-radar")];
  return mergeEnvOverrides(lines, parseEnvBasicAdsJson(env.basicAdsJson));
}
