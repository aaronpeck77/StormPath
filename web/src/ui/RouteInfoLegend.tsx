/**
 * In-panel guide for the Route info graph — kept here so product copy tracks the glance panel layers.
 */
export function RouteInfoLegend() {
  return (
    <details className="rpgl__help">
      <summary className="rpgl__help-summary">What this panel shows</summary>
      <ul className="rpgl__help-list">
        <li>
          <strong>YOU → DEST</strong> — Your position (vertical line) moves along the trip. Milestone
          labels are drive-time ETAs to each point on the route.
        </li>
        <li>
          <strong>Route outlook</strong> — Temperature (orange) and rain chance (blue) sampled along
          your corridor from Tomorrow.io and OpenWeather. The rain line only rises when intensity or
          wording supports it — not every low model probability.
        </li>
        <li>
          <strong>Radar</strong> — echo along the route at your estimated arrival time on longer
          trips (RainViewer nowcast). The live map uses Tomorrow.io in the US with RainViewer
          short-term forecast frames at the end of the animation loop; elsewhere it uses RainViewer
          past and nowcast. Shaded area is modeled precipitation, not a guarantee you will drive
          through rain.
        </li>
        <li>
          <strong>Wind</strong> — amber line is sustained wind along the route; short orange ticks
          are brief gust spikes (40+ mph and well above sustained). Corridor warnings use
          sustained speed; gusts stay localized.
        </li>
        <li>
          <strong>NWS / Road</strong> — Bands when National Weather Service warnings or Mapbox
          traffic/closures overlap your path. Faded bands are nearby but not directly on the route
          line.
        </li>
        <li>
          <strong>Cards below</strong> — Same unified Road Ahead list. Badges: NWS, RAD (radar), WIND,
          FCST (forecast text), RD (road/traffic). Tap Refresh (Plus) to reload corridor weather.
        </li>
        <li>
          <strong>Not here</strong> — Live map radar (Rad toggle), local forecast at your GPS in the
          storm bar, and turn-by-turn on the top banner.
        </li>
      </ul>
    </details>
  );
}
