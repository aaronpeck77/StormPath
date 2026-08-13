import type { getWebEnv } from "./env";

export type AdvisoryPromoAction = "open-subscription";

export type AdvisoryPromoLine = {
  id: string;
  text: string;
  /** Opens in a new tab when the row is a link. */
  href?: string;
  /** Shown in expanded advisory strip when set; falls back to `text`. */
  detailText?: string;
  /** Partner promos show a small “Sponsored” label in the advisory strip. */
  sponsored?: boolean;
  /** In-app action when `href` is unset (e.g. open About → Subscription). */
  action?: AdvisoryPromoAction;
  /** Primary upsell card styling in the Basic status panel. */
  featured?: boolean;
  /** Larger partner card styling in the Basic status panel. */
  prominent?: boolean;
  /** Reserved banner placement between forecast and Plus upsell. */
  bannerSlot?: boolean;
  /** Button label on featured / action rows (expanded panel). */
  ctaLabel?: string;
};

export type BasicStatusPanelPromos = {
  /** Programmatic / partner banner — always reserved; link when `href` is set. */
  partnerSlot: AdvisoryPromoLine;
  plusUpsell: AdvisoryPromoLine;
};

export const PARTNER_AD_BAR = "Sponsored partner offer — tap for details";

type WebEnv = ReturnType<typeof getWebEnv>;

/** Optional partner slot — only surfaces when `VITE_PARTNER_AD_URL` (or JSON override) is set. */
const BUILTIN_PARTNER_ADS: Array<{
  id: string;
  barText: string;
  detailText: string;
  href?: (env: WebEnv) => string | undefined;
  sponsored?: boolean;
  ctaLabel?: string;
}> = [
  {
    id: "partner-sponsored",
    barText: PARTNER_AD_BAR,
    detailText: "Sponsored partner offer. Tap to learn more.",
    href: (env) => env.partnerAdUrl || undefined,
    sponsored: true,
    ctaLabel: "Learn more",
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
    /* SiteBible / cross-product ads are not shown in StormPath. */
    if (o.id === "sitebible") continue;
    const prev = byId.get(o.id);
    byId.set(o.id, {
      ...prev,
      id: o.id,
      text: o.text,
      detailText: o.detailText ?? prev?.detailText,
      href: o.href ?? prev?.href,
      sponsored: o.sponsored ?? prev?.sponsored,
    });
  }
  return Array.from(byId.values());
}

function partnerBannerSlot(env: WebEnv): AdvisoryPromoLine {
  const ad = BUILTIN_PARTNER_ADS.find((row) => row.id === "partner-sponsored")!;
  return {
    id: ad.id,
    text: ad.barText,
    detailText: ad.detailText,
    href: ad.href?.(env),
    sponsored: ad.sponsored,
    ctaLabel: ad.ctaLabel,
    bannerSlot: true,
  };
}

function partnerLines(env: WebEnv): AdvisoryPromoLine[] {
  return BUILTIN_PARTNER_ADS.map((ad) => ({
    id: ad.id,
    text: ad.barText,
    detailText: ad.detailText,
    href: ad.href?.(env),
    sponsored: ad.sponsored,
    ctaLabel: ad.ctaLabel,
  })).filter((ad) => ad.text.length > 0 && (ad.id !== "partner-sponsored" || ad.href));
}

function plusUpsellLine(env: WebEnv, variant: "full" | "nav-radar"): AdvisoryPromoLine {
  const full = {
    text: "StormPath Plus — full NWS, traffic, and route weather",
    detail:
      "Unlock live traffic, the full NWS hazard map, minute-by-minute precip, and weather along your route.",
  };
  const navRadar = {
    text: "Upgrade to StormPath Plus",
    detail:
      "Live traffic, full NWS map, route weather, and hazard tools — tap to subscribe in StormPath.",
  };
  const copy = variant === "full" ? full : navRadar;
  const base: AdvisoryPromoLine = {
    id: "sp-plus-upsell",
    text: copy.text,
    detailText: copy.detail,
    featured: true,
    ctaLabel: "View StormPath Plus",
  };
  if (env.upgradeUrl) {
    return { ...base, href: env.upgradeUrl, ctaLabel: "Upgrade on the App Store" };
  }
  return { ...base, action: "open-subscription" };
}

function connectivityTip(id: string): AdvisoryPromoLine {
  return {
    id,
    text: "Tip: routes and map tiles load faster on Wi‑Fi or stronger cell signal.",
    detailText:
      "Tip: map tiles and route data load faster on Wi‑Fi or stronger cell signal.",
  };
}

function driveSafetyTip(id: string): AdvisoryPromoLine {
  return {
    id,
    text: "Tip: expand this bar for NWS alerts, traffic, and weather along your route.",
    detailText:
      "Tip: tap this status bar anytime for NWS alerts, traffic delays, and weather along your route — each alert names the hazard it covers.",
  };
}

/**
 * Rotating copy in the advisory strip — partner offer (when URL set), optional Plus upsell, tips.
 * Edit defaults here or set `VITE_BASIC_ADS_JSON` / `VITE_PARTNER_AD_URL` / `VITE_UPGRADE_URL`.
 */
export function buildAdvisoryPromoLines(env: WebEnv, ownsPlus: boolean): AdvisoryPromoLine[] {
  const lines: AdvisoryPromoLine[] = [...partnerLines(env)];

  if (!ownsPlus) lines.push(plusUpsellLine(env, "full"));
  lines.push(connectivityTip("tip-net"));
  lines.push(driveSafetyTip("tip-status-bar"));

  return mergeEnvOverrides(lines, parseEnvBasicAdsJson(env.basicAdsJson));
}

/** Basic tier status panel: partner banner slot + StormPath Plus upsell. */
export function buildBasicNavStatusPanelPromos(env: WebEnv): BasicStatusPanelPromos {
  const merged = mergeEnvOverrides(
    [partnerBannerSlot(env), plusUpsellLine(env, "nav-radar")],
    parseEnvBasicAdsJson(env.basicAdsJson)
  );
  const byId = new Map(merged.map((l) => [l.id, l]));

  return {
    partnerSlot: { ...byId.get("partner-sponsored")!, bannerSlot: true },
    plusUpsell: byId.get("sp-plus-upsell")!,
  };
}

/** Basic tier collapsed rotator: Plus upsell, optional partner when URL is set, tips. */
export function buildBasicNavAdvisoryPromoLines(env: WebEnv): AdvisoryPromoLine[] {
  const panel = buildBasicNavStatusPanelPromos(env);
  const lines: AdvisoryPromoLine[] = [panel.plusUpsell, connectivityTip("tip-net-basic")];
  if (panel.partnerSlot.href) lines.push(panel.partnerSlot);
  return lines;
}
