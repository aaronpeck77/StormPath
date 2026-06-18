import { ROUTE_PICK_SLOT_HEX } from "./mapRouteStyle";
import { corridorHighlightHex } from "../nav/routeAlerts";
import { nwsMapKindHex } from "../weatherAlerts/nwsMapKind";

/**
 * What every color / banner / pin on the map means while driving. Lives inside the About sheet
 * so it inherits the iOS-grouped panel chrome and a single scroll container.
 *
 * Swatches are sourced from the same constants the map uses (see `mapRouteStyle`, `routeAlerts`,
 * `nwsMapKind`, `mapTrafficLayers`) so the legend stays in sync if any color is ever retuned —
 * the legend should not become a stale documentation copy.
 */

type SwatchKind = "line" | "casing" | "polygon" | "pin" | "block";

type LegendRow = {
  label: string;
  color: string;
  kind: SwatchKind;
  blurb: string;
  /** Optional dasharray for closed-road / dashed-line styles. */
  dashed?: boolean;
};

type LegendGroup = {
  title: string;
  intro?: string;
  rows: LegendRow[];
};

function Swatch({ color, kind, dashed }: { color: string; kind: SwatchKind; dashed?: boolean }) {
  if (kind === "pin") {
    return (
      <span
        className="map-key__swatch map-key__swatch--pin"
        style={{ background: color }}
        aria-hidden="true"
      />
    );
  }
  if (kind === "block") {
    return (
      <span
        className="map-key__swatch map-key__swatch--block"
        style={{ background: color }}
        aria-hidden="true"
      />
    );
  }
  if (kind === "polygon") {
    return (
      <span
        className="map-key__swatch map-key__swatch--polygon"
        style={{ background: "transparent", borderColor: color }}
        aria-hidden="true"
      />
    );
  }
  if (kind === "casing") {
    /* Visual: blue route line on top of the casing color so the "shadow under the route" pattern reads. */
    return (
      <span className="map-key__swatch map-key__swatch--casing" aria-hidden="true">
        <span className="map-key__swatch-casing-bg" style={{ background: color }} />
        <span className="map-key__swatch-casing-fg" />
      </span>
    );
  }
  return (
    <span
      className={`map-key__swatch map-key__swatch--line${dashed ? " map-key__swatch--dashed" : ""}`}
      style={{ background: color }}
      aria-hidden="true"
    />
  );
}

const ROUTE_LINE_GROUP: LegendGroup = {
  title: "Route lines",
  intro:
    "When you're picking a route you'll see up to three options. Once you tap Go, the active route turns blue.",
  rows: [
    {
      label: "Route A — primary pick",
      color: ROUTE_PICK_SLOT_HEX[0],
      kind: "line",
      blurb: "First option the planner shows. Tap it on the right rail or map to make it active.",
    },
    {
      label: "Route B — green alternate",
      color: ROUTE_PICK_SLOT_HEX[1],
      kind: "line",
      blurb: "Second option — usually a slightly different corridor than A.",
    },
    {
      label: "Route C — amber alternate / next-exit bypass",
      color: ROUTE_PICK_SLOT_HEX[2],
      kind: "line",
      blurb:
        "Third option in planning. During a bypass it's the side-road / next-exit detour around a hazard.",
    },
    {
      label: "Active route while driving",
      color: "#1a73e8",
      kind: "line",
      blurb:
        "Once Go is on, the leg you're driving is always blue regardless of which slot you picked.",
    },
  ],
};

const CASING_GROUP: LegendGroup = {
  title: "Conditions on your route (colored casing under the line)",
  intro:
    "When something on the corridor matters, a wider colored band is drawn UNDER the route line so the blue stays readable.",
  rows: [
    {
      label: "Severe traffic / closure",
      color: corridorHighlightHex("traffic", 90),
      kind: "casing",
      blurb: "Severe slowdown or full closure ahead — bypass is offered when it qualifies.",
    },
    {
      label: "Heavy traffic / blocking incident",
      color: corridorHighlightHex("traffic", 60),
      kind: "casing",
      blurb: "Heavy backup or lane-blocking incident — slow approach, possible reroute.",
    },
    {
      label: "Construction / minor incident",
      color: corridorHighlightHex("traffic", 40),
      kind: "casing",
      blurb: "Construction zone or non-blocking incident — be ready for slowdowns.",
    },
    {
      label: "Severe weather on route",
      color: corridorHighlightHex("weather", 80),
      kind: "casing",
      blurb: "Tornado / severe storm / flooding band crosses your path.",
    },
    {
      label: "Weather advisory on route",
      color: corridorHighlightHex("weather", 40),
      kind: "casing",
      blurb: "Wind / winter / general weather watch overlapping the corridor.",
    },
    {
      label: "Fog / low visibility",
      color: nwsMapKindHex("vis"),
      kind: "casing",
      blurb: "Fog, smoke, or dust advisory. Slow down and use low beams — no reroute needed.",
    },
  ],
};

const TRAFFIC_GROUP: LegendGroup = {
  title: "Mapbox traffic overlay",
  intro:
    "When the Traffic toggle is on, live road conditions paint short colored segments across the basemap (not just your route).",
  rows: [
    {
      label: "Heavy congestion",
      color: "#c2410c",
      kind: "line",
      blurb: "Stop-and-go or heavy backup on that stretch.",
    },
    {
      label: "Severe congestion",
      color: "#dc2626",
      kind: "line",
      blurb: "Worst category — long delay or near-stopped traffic.",
    },
    {
      label: "Closed road",
      color: "#a855f7",
      kind: "line",
      dashed: true,
      blurb: "Mapbox marks the road as closed. Routing avoids it automatically.",
    },
  ],
};

const WEATHER_POLY_GROUP: LegendGroup = {
  title: "Weather polygons (NWS map shapes)",
  intro:
    "Storm shapes from the National Weather Service — outline only so radar and the basemap stay readable. Color tells you what kind of alert.",
  rows: [
    {
      label: "Severe storm / tornado",
      color: nwsMapKindHex("convective"),
      kind: "polygon",
      blurb: "Tornado, severe thunderstorm, hurricane, tropical, storm surge.",
    },
    {
      label: "Flood / hydro",
      color: nwsMapKindHex("hydro"),
      kind: "polygon",
      blurb: "Flash flood, river flood, coastal flood, tsunami.",
    },
    {
      label: "Winter weather",
      color: nwsMapKindHex("winter"),
      kind: "polygon",
      blurb: "Ice, snow, blizzard, wind chill, freeze.",
    },
    {
      label: "High wind",
      color: nwsMapKindHex("wind"),
      kind: "polygon",
      blurb: "Wind advisory or warning, blowing dust.",
    },
    {
      label: "Fire weather",
      color: nwsMapKindHex("fire"),
      kind: "polygon",
      blurb: "Red flag warning, fire weather watch.",
    },
    {
      label: "Heat",
      color: nwsMapKindHex("heat"),
      kind: "polygon",
      blurb: "Excessive heat advisory or warning.",
    },
    {
      label: "Marine",
      color: nwsMapKindHex("marine"),
      kind: "polygon",
      blurb: "Small craft, gale, high surf, beach hazards.",
    },
    {
      label: "Visibility",
      color: nwsMapKindHex("vis"),
      kind: "polygon",
      blurb: "Dense fog, freezing fog, smoke.",
    },
  ],
};

const PUCK_PIN_GROUP: LegendGroup = {
  title: "Puck and pins",
  rows: [
    {
      label: "You / current GPS position",
      color: "#1a73e8",
      kind: "pin",
      blurb: "Blue puck. Brighter and outlined while driving so it pops on either basemap.",
    },
    {
      label: "Hazard pin",
      color: "#dc2626",
      kind: "pin",
      blurb:
        "Pulsing red ! marker shown when the bypass-compare panel opens. Marks the spot the alternates are routing around.",
    },
    {
      label: "Saved place",
      color: "#0ea5e9",
      kind: "pin",
      blurb: "Cyan dot for places you've saved (favorites, frequent stops).",
    },
    {
      label: "Destination",
      color: "#16a34a",
      kind: "pin",
      blurb: "Green pin at the end of the active trip.",
    },
    {
      label: "Activity trail (Plus)",
      color: "#06b6d4",
      kind: "pin",
      blurb:
        "Faint cyan dots showing where you've driven before. Toggle in About → Activity trail.",
    },
  ],
};

const BANNER_GROUP: LegendGroup = {
  title: "Bars and banners",
  rows: [
    {
      label: "Storm advisory bar",
      color: "#7c3aed",
      kind: "block",
      blurb:
        "Top strip when NWS alerts are active. Tap to expand. Color matches the worst event class on screen.",
    },
    {
      label: "Approach banner",
      color: "#dc2626",
      kind: "block",
      blurb:
        "\"Tap to plan around it\" prompt when a real reroute-able hazard is ahead. Tap once to open the A/B/C bypass compare.",
    },
    {
      label: "Bypass compare panel",
      color: "#1a73e8",
      kind: "block",
      blurb:
        "Shows the original (A) vs full reroute (B) vs side-road / next-exit detour (C). Tap one to switch routes.",
    },
  ],
};

const GROUPS: LegendGroup[] = [
  ROUTE_LINE_GROUP,
  CASING_GROUP,
  TRAFFIC_GROUP,
  WEATHER_POLY_GROUP,
  PUCK_PIN_GROUP,
  BANNER_GROUP,
];

export function MapKeyPanel() {
  return (
    <section className="about-sheet__panel about-sheet__panel--map-key">
      <h3 className="about-sheet__h3">Map key</h3>
      <p className="about-sheet__p">
        What the colors and chrome on the map mean. Swatches are pulled from the live app constants
        — they should match what you see on screen.
      </p>
      {GROUPS.map((group) => (
        <details key={group.title} className="about-sheet__details about-sheet__details--inline map-key__group">
          <summary>{group.title}</summary>
          {group.intro ? <p className="about-sheet__p map-key__intro">{group.intro}</p> : null}
          <ul className="map-key__rows">
            {group.rows.map((row) => (
              <li key={row.label} className="map-key__row">
                <Swatch color={row.color} kind={row.kind} dashed={row.dashed} />
                <div className="map-key__row-text">
                  <span className="map-key__row-label">{row.label}</span>
                  <span className="map-key__row-blurb">{row.blurb}</span>
                </div>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </section>
  );
}
