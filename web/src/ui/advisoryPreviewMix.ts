/** Target share of promo / tip rows in the collapsed advisory rotator (trip gets the rest). */
export const ADVISORY_PROMO_SHARE = 0.5;

/**
 * Interleave trip-critical preview rows with app promos and tips so route info is never drowned out.
 * When trip context exists, promo slots are capped at a 1:1 ratio (50/50). With no trip rows, at most
 * two promo lines are shown.
 */
export function mixAdvisoryPreviewItems<T>(trip: T[], promo: T[], promoShare = ADVISORY_PROMO_SHARE): T[] {
  if (trip.length === 0) return promo.slice(0, 2);
  if (promo.length === 0) return trip;

  const share = Math.min(0.9, Math.max(0.1, promoShare));
  const maxPromo = Math.max(1, Math.round((trip.length * share) / (1 - share)));
  const cappedPromo = promo.slice(0, Math.min(promo.length, maxPromo));

  const out: T[] = [];
  const slots = Math.max(trip.length, cappedPromo.length);
  for (let i = 0; i < slots; i++) {
    if (i < trip.length) out.push(trip[i]!);
    if (i < cappedPromo.length) out.push(cappedPromo[i]!);
  }
  return out;
}

/** Expanded advisory: keep partner / upsell copy from dominating when route or weather panels are shown. */
export function limitExpandedPromoLines<T>(lines: T[], hasTripOrWeatherContent: boolean, maxWhenBusy = 2): T[] {
  if (!hasTripOrWeatherContent) return lines;
  return lines.slice(0, maxWhenBusy);
}
