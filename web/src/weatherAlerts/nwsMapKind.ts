/**
 * NWS api.weather.gov does not ship a map hex color. We derive a stable "kind" from the CAP
 * `event` string so flood vs ice vs fire read differently on the map (severity alone is too coarse).
 */

export type NwsMapKind =
  | "hydro"
  | "winter"
  | "fire"
  | "convective"
  | "marine"
  | "wind"
  | "heat"
  | "vis"
  | "other";

/** Classify CAP event name for map tint (order matters for overlapping keywords). */
export function nwsMapKindFromEvent(event: string): NwsMapKind {
  const e = event.toLowerCase();

  if (/(tornado|severe thunderstorm|hurricane|tropical storm|tropical depression|typhoon|storm surge)/i.test(event))
    return "convective";
  if (/(red flag|fire weather|wildfire|extreme fire)/i.test(event)) return "fire";
  if (/(excessive heat|heat advisory|extreme heat)/i.test(event)) return "heat";
  if (/(flood|flash flood|hydrologic|tsunami|coastal flood|lakeshore flood|river)/i.test(event)) return "hydro";
  if (/(small craft|marine|gale|high surf|rough surf|beach hazards|heavy freezing spray|brisk winds)/i.test(event))
    return "marine";
  if (/(dense fog|fog advisory|freezing fog)/i.test(event)) return "vis";
  if (/(wind chill|extreme cold)/i.test(event)) return "winter";
  if (/(high wind|wind advisory|wind warning|blowing dust)/i.test(event) && !/thunderstorm/.test(e)) return "wind";
  if (
    /(ice|winter|blizzard|snow|freeze|frost|sleet|freezing rain|avalanche|cold weather|wind chill)/i.test(event)
  ) {
    return "winter";
  }
  return "other";
}

/** Distinct hues per kind; "other" uses severity fallback in the map layer. */
export function nwsMapKindHex(kind: NwsMapKind): string {
  switch (kind) {
    case "hydro":
      return "#2563eb"; // blue-600 — flood / hydrology
    case "winter":
      return "#0e7490"; // cyan-700 — ice / snow / freeze (distinct from flood blue)
    case "fire":
      return "#dc2626"; // red-600
    case "convective":
      return "#ea580c"; // orange-600
    case "marine":
      return "#0d9488"; // teal-600
    case "wind":
      return "#a855f7"; // purple-500
    case "heat":
      return "#b91c1c"; // red-800
    case "vis":
      return "#64748b"; // slate-500
    default:
      return "#94a3b8";
  }
}
