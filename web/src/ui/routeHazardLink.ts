export type HazardLinkBand = { id: string; left: number; width: number };

export function hazardIdsAtPosition(bands: HazardLinkBand[], percent: number, fallbackId: string): string[] {
  if (!Number.isFinite(percent)) return [fallbackId];
  const ids = bands.filter((band) => percent >= band.left && percent <= band.left + band.width).map((band) => band.id);
  return [...new Set(ids.length ? ids : [fallbackId])];
}

export function scrollHazardCard(panel: HTMLElement, card: HTMLElement) {
  const top = card.getBoundingClientRect().top - panel.getBoundingClientRect().top + panel.scrollTop;
  panel.scrollTo({ top: Math.max(0, top - 6), behavior: "smooth" });
}

export function scrollHazardBand(panel: HTMLElement, band: HTMLElement) {
  const panelRect = panel.getBoundingClientRect();
  const rect = band.getBoundingClientRect();
  const left = panel.scrollLeft + rect.left - panelRect.left - (panel.clientWidth - rect.width) / 2;
  panel.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
}
