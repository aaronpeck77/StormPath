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
  /** Larger partner card in the Basic status panel (SiteBible). */
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
  siteBible: AdvisoryPromoLine;
};

/** Collapsed bar preview; long copy scrolls horizontally in the advisory bar when it doesn’t fit. */
export const SITEBIBLE_AD_BAR =
  "SiteBible — security & preparedness reference · App Store";

/** Until `VITE_SITEBIBLE_URL` points at the live App Store product page. */
export const SITEBIBLE_APP_STORE_FALLBACK = "https://apps.apple.com/search?term=SiteBible";

export const PARTNER_AD_BAR = "Sponsored partner offer — tap for details";

type WebEnv = ReturnType<typeof getWebEnv>;

/** First-party partner slots — edit copy here; wire URLs via env. */
const BUILTIN_PARTNER_ADS: Array<{
  id: string;
  barText: string;
  detailText: string;
  href?: (env: WebEnv) => string | undefined;
  sponsored?: boolean;
  ctaLabel?: string;
}> = [
  {
    id: "sitebible",
    barText: SITEBIBLE_AD_BAR,
    detailText:
      "SiteBible — digital security and preparedness reference. Tap to open on the App Store.",
    href: (env) => env.siteBibleUrl || SITEBIBLE_APP_STORE_FALLBACK,
    sponsored: true,
    ctaLabel: "Open on App Store",
  },
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
    prominent: ad.id === "sitebible",
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

/**
 * Rotating copy in the advisory strip — weather line, SiteBible, optional Plus upsell (Basic only), tips.
 * Edit defaults in `basicAds.ts` or set `VITE_BASIC_ADS_JSON` / `VITE_SITEBIBLE_URL` / `VITE_UPGRADE_URL`.
 */
export function buildAdvisoryPromoLines(env: WebEnv, ownsPlus: boolean): AdvisoryPromoLine[] {
  const lines: AdvisoryPromoLine[] = [...partnerLines(env)];

  if (!ownsPlus) lines.push(plusUpsellLine(env, "full"));
  lines.push(connectivityTip("tip-net"));

  return mergeEnvOverrides(lines, parseEnvBasicAdsJson(env.basicAdsJson));
}

/** Basic tier status panel: partner banner slot, StormPath Plus upsell, SiteBible. */
export function buildBasicNavStatusPanelPromos(env: WebEnv): BasicStatusPanelPromos {
  const partners = partnerLines(env);
  const siteBible =
    partners.find((p) => p.id === "sitebible") ??
    ({
      id: "sitebible",
      text: SITEBIBLE_AD_BAR,
      detailText:
        "SiteBible — digital security and preparedness reference. Tap to open on the App Store.",
      href: env.siteBibleUrl || SITEBIBLE_APP_STORE_FALLBACK,
      sponsored: true,
      ctaLabel: "Open on App Store",
      prominent: true,
    } satisfies AdvisoryPromoLine);

  const merged = mergeEnvOverrides(
    [partnerBannerSlot(env), plusUpsellLine(env, "nav-radar"), { ...siteBible, prominent: true }],
    parseEnvBasicAdsJson(env.basicAdsJson)
  );
  const byId = new Map(merged.map((l) => [l.id, l]));

  return {
    partnerSlot: { ...byId.get("partner-sponsored")!, bannerSlot: true },
    plusUpsell: byId.get("sp-plus-upsell")!,
    siteBible: { ...byId.get("sitebible")!, prominent: true },
  };
}

/** Basic tier collapsed rotator: Plus upsell, SiteBible, optional partner when URL is set. */
export function buildBasicNavAdvisoryPromoLines(env: WebEnv): AdvisoryPromoLine[] {
  const panel = buildBasicNavStatusPanelPromos(env);
  const lines: AdvisoryPromoLine[] = [panel.plusUpsell, panel.siteBible];
  if (panel.partnerSlot.href) lines.push(panel.partnerSlot);
  return lines;
}
