/**
 * Always-on Mapbox logo in the reserved gap under the bottom chrome.
 * OSM / RainViewer / NWS / WeatherKit names live on weather panels & About — not the map face.
 * Compact Mapbox © attribution (“i”) still covers OSM in the map control.
 */
export function MapLegalAttributionStrip() {
  return (
    <div className="map-legal-attr-strip" aria-label="Mapbox">
      <a
        className="map-legal-attr-strip__mapbox mapboxgl-ctrl-logo"
        href="https://www.mapbox.com/about/maps/"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Mapbox"
        title="Mapbox"
      />
    </div>
  );
}
