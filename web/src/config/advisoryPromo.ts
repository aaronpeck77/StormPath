import { getWebEnv } from "./env";

export type AdvisoryPromoLine = {
  id: string;
  text: string;
  /** Opens in a new tab when the row is a link. */
  href?: string;
};

/** Shown in the expanded advisory and in the Basic promo rotation (set expectations before backend upgrades). */
export const ADVISORY_WEATHER_UPGRADES_COMING_SOON =
  "Weather data and reporting upgrades are coming soon.";

/** Collapsed bar preview; long copy scrolls horizontally in the advisory bar when it doesn’t fit. */
export const SITEBIBLE_AD_BAR =
  "Coming Soon - SiteBible - Digital Security Database - Check App Store";

/**
 * Rotating copy in the advisory strip — weather line, SiteBible, optional Plus upsell (Basic only), tips.
 * Edit defaults here or set `VITE_SITEBIBLE_URL` / `VITE_UPGRADE_URL` in env.
 */
export function buildAdvisoryPromoLines(
  env: ReturnType<typeof getWebEnv>,
  /** When true, omit the “upgrade to Plus” promos — subscriber already has Plus. */
  ownsPlus: boolean
): AdvisoryPromoLine[] {
  const lines: AdvisoryPromoLine[] = [
    { id: "sp-weather-upgrades-soon", text: ADVISORY_WEATHER_UPGRADES_COMING_SOON },
  ];
  let n = 0;

  lines.push({
    id: "sitebible",
    text: SITEBIBLE_AD_BAR,
    href: env.siteBibleUrl || undefined,
  });

  if (!ownsPlus) {
    if (env.upgradeUrl) {
      lines.push({
        id: `sp-plus-${n++}`,
        text: "StormPath Plus: full NWS map, traffic, and weather along your route.",
        href: env.upgradeUrl,
      });
    } else {
      lines.push({
        id: `sp-plus-${n++}`,
        text: "StormPath Plus adds the full hazard map, live traffic, and weather along your route.",
      });
    }
  }

  lines.push({
    id: `tip-net-${n++}`,
    text: "Tip: routes and map tiles load faster on Wi‑Fi or stronger cell signal.",
  });

  return lines;
}
