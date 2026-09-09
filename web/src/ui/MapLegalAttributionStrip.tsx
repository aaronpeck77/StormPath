/**
 * Always-on legal strip in the reserved gap under the bottom chrome.
 * Mapbox logo + short map/radar/alert names. Full  Weather mark stays on weather panels.
 */
export function MapLegalAttributionStrip() {
  return (
    <div className="map-legal-attr-strip" aria-label="Map data attribution">
      <a
        className="map-legal-attr-strip__mapbox mapboxgl-ctrl-logo"
        href="https://www.mapbox.com/about/maps/"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Mapbox"
        title="Mapbox"
      />
      <a
        className="map-legal-attr-strip__name"
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noopener noreferrer"
      >
        © OSM
      </a>
      <a
        className="map-legal-attr-strip__name"
        href="https://www.rainviewer.com/"
        target="_blank"
        rel="noopener noreferrer"
      >
        RainViewer
      </a>
      <a
        className="map-legal-attr-strip__name"
        href="https://www.weather.gov/"
        target="_blank"
        rel="noopener noreferrer"
      >
        NWS
      </a>
    </div>
  );
}
