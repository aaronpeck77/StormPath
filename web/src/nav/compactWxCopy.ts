/** Glanceable progress-panel / strip copy — abbreviations common in aviation & NWS products. */

export function abbrevNwsEvent(event: string): string {
  const e = event.trim();
  if (!e) return "NWS";
  if (/tornado warning/i.test(e)) return "TOR Wrn";
  if (/severe thunderstorm warning/i.test(e)) return "SVR TSTM Wrn";
  if (/thunderstorm warning/i.test(e)) return "TSTM Wrn";
  if (/flash flood warning/i.test(e)) return "FF Wrn";
  if (/flood warning/i.test(e)) return "FL Wrn";
  if (/winter storm warning/i.test(e)) return "WS Wrn";
  if (/blizzard warning/i.test(e)) return "BZ Wrn";
  if (/high wind warning/i.test(e)) return "HW Wrn";
  if (/dense fog advisory/i.test(e)) return "FG Adv";
  if (/wind advisory/i.test(e)) return "WND Adv";
  if (/severe thunderstorm watch/i.test(e)) return "SVR TSTM Watch";
  if (/tornado watch/i.test(e)) return "TOR Watch";
  if (/flood watch/i.test(e)) return "FL Watch";
  if (/special weather statement/i.test(e)) return "SPS";
  if (e.length <= 28) return e;
  return `${e.slice(0, 26)}…`;
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

  if (h.length > 52) h = `${h.slice(0, 50)}…`;
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
  const joined = bits.filter(Boolean).join(" · ");
  return joined.length > 118 ? `${joined.slice(0, 116)}…` : joined;
}
