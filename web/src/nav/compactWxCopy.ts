import { displayText } from "../utils/displayText";

/** Full NWS event name for progress / corridor copy. */
export function abbrevNwsEvent(event: string): string {
  return displayText(event) || "NWS";
}

/** One short OpenWeather-style line for a segment (no clouds % clutter). */
export function compactSegmentWx(headline: string, precipHint?: number): string {
  let h = headline
    .replace(/;\s*clouds\s*\d+%/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!h) return "";

  if (/thunder|tstm|storm/i.test(h)) h = `⛈ ${h}`;
  else if (/snow|sleet|ice|wintry/i.test(h)) h = `❄ ${h}`;
  else if (/rain|shower|drizzle/i.test(h)) h = `🌧 ${h}`;
  else if (/fog|mist/i.test(h)) h = `🌫 ${h}`;
  else if (/wind/i.test(h)) h = `💨 ${h}`;
  else h = `☁ ${h}`;

  if (precipHint != null && precipHint >= 0.72) h = h.replace(/^.\s/, "🌧 Hvy ");
  else if (precipHint != null && precipHint >= 0.45) h = h.replace(/^.\s/, "🌧 ");

  return h;
}

/** Whole-route forecast headline → one line (Start/Mid/Dest labels stripped). */
export function compactRouteOutlook(forecastHeadline: string): string {
  const h = forecastHeadline.trim();
  if (!h) return "";
  const parts = h.split(/\s*(?:→|\u2192)\s*/).map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 1) return compactSegmentWx(h);
  const bits = parts.map((p) => {
    const body = p.replace(/^(Start|Quarter|Midway|3\/4|Destination):?\s*/i, "").trim();
    const label = /^Start\b/i.test(p)
      ? "Go"
      : /^Destination\b/i.test(p)
        ? "End"
        : /^Midway\b/i.test(p)
          ? "Mid"
          : /^Quarter\b/i.test(p)
            ? "¼"
            : /^3\/4/i.test(p)
              ? "¾"
              : "";
    const wx = compactSegmentWx(body);
    return label && wx ? `${label}: ${wx}` : wx;
  });
  return bits.filter(Boolean).join(" · ");
}
