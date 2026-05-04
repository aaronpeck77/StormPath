import { useEffect, useState } from "react";
import type { SavedPlace } from "../nav/savedPlaces";
import type { SavedRoute } from "../nav/savedRoutes";
import type { LngLat } from "../nav/types";
import type { FrequentRouteCluster } from "../frequentRoutes/types";

type Props = {
  open: boolean;
  onClose: () => void;
  places: SavedPlace[];
  showOnMap: boolean;
  onToggleShowOnMap: (v: boolean) => void;
  onGo: (lngLat: LngLat, label: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onSaveCurrent: (() => void) | null;
  currentDestLabel: string | null;
  currentDestLngLat: LngLat | null;
  savedRoutes: SavedRoute[];
  onSaveCurrentRoute: (() => void) | null;
  onGoSavedRoute: (r: SavedRoute, opts?: { reverse?: boolean }) => void;
  onRenameSavedRoute: (id: string, name: string) => void;
  onDeleteSavedRoute: (id: string) => void;
  onStartRecordingPath: (() => void) | null;
  recordingActive: boolean;
  /** Plus: frequent-route learning */
  payFrequentRoutes: boolean;
  frequentRouteSuggestions: FrequentRouteCluster[];
  frequentRoutesLearnEnabled: boolean;
  onFrequentRoutesLearnEnabled: (on: boolean) => void;
  onTryFrequentRoute: (c: FrequentRouteCluster) => void;
  onSaveFrequentRoute: (c: FrequentRouteCluster) => void;
  onDismissFrequentRoute: (id: string) => void;
};

export function SavedDestinationsDrawer({
  open,
  onClose,
  places,
  showOnMap,
  onToggleShowOnMap,
  onGo,
  onRename,
  onDelete,
  onSaveCurrent,
  currentDestLabel,
  currentDestLngLat,
  savedRoutes,
  onSaveCurrentRoute,
  onGoSavedRoute,
  onRenameSavedRoute,
  onDeleteSavedRoute,
  onStartRecordingPath,
  recordingActive,
  payFrequentRoutes,
  frequentRouteSuggestions,
  frequentRoutesLearnEnabled,
  onFrequentRoutesLearnEnabled,
  onTryFrequentRoute,
  onSaveFrequentRoute,
  onDismissFrequentRoute,
}: Props) {
  if (!open) return null;

  return (
    <>
      <div className="saved-drawer-scrim" role="presentation" onClick={onClose} />
      <div className="saved-drawer" role="dialog" aria-labelledby="saved-drawer-title">
        <div className="saved-drawer-head">
          <h2 id="saved-drawer-title" className="saved-drawer-title">
            Saved
          </h2>
          <button type="button" className="saved-drawer-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="saved-drawer-body">
          <label className="saved-drawer-toggle">
            <input
              type="checkbox"
              checked={showOnMap}
              onChange={(e) => onToggleShowOnMap(e.target.checked)}
            />
            <span>Show place pins on map</span>
          </label>

          <div className="saved-drawer-panes">
            <section className="saved-drawer-pane" aria-labelledby="saved-places-heading">
              <div className="saved-drawer-pane__card">
                <header className="saved-drawer-pane__chrome">
                  <p id="saved-places-heading" className="saved-drawer-section-label">
                    Places
                  </p>
                  <p className="saved-drawer-pane__kicker">Saved pins on the map — Go sets destination only.</p>
                  {onSaveCurrent && currentDestLngLat && (
                    <button type="button" className="saved-drawer-save-current" onClick={onSaveCurrent}>
                      Save current destination
                      {currentDestLabel ? ` (${currentDestLabel})` : ""}
                    </button>
                  )}
                </header>
                <div className="saved-drawer-pane__scroll" role="region" aria-label="Saved places list">
                <ul className="saved-drawer-list saved-drawer-list--embedded">
                  {places.length === 0 && (
                    <li className="saved-drawer-empty">
                      No saved places yet. Set a destination and build a route, then tap ★ and use{" "}
                      <strong>Save current destination</strong> before you hit Go.
                    </li>
                  )}
                  {places.map((p) => (
                    <SavedRow key={p.id} place={p} onGo={onGo} onRename={onRename} onDelete={onDelete} />
                  ))}
                </ul>
                </div>
              </div>
            </section>

            <section className="saved-drawer-pane" aria-labelledby="saved-routes-heading">
              <div className="saved-drawer-pane__card">
                <header className="saved-drawer-pane__chrome">
                  <p id="saved-routes-heading" className="saved-drawer-section-label">
                    Saved routes
                  </p>
                  <p className="saved-drawer-pane__kicker">Full path kept — record or save from the map.</p>
                </header>
                <div className="saved-drawer-pane__scroll" role="region" aria-label="Saved routes and tools">
                <p className="saved-drawer-route-hint saved-drawer-route-hint--pane-top">
                  Save the line on the map, or record a drive when the router won’t follow your road. Use{" "}
                  <strong>Rev</strong> on a saved route to flip direction.
                </p>
                {onStartRecordingPath && (
                  <button
                    type="button"
                    className="saved-drawer-save-current saved-drawer-save-current--record"
                    onClick={onStartRecordingPath}
                  >
                    Record driven path (GPS)
                  </button>
                )}
                {recordingActive && (
                  <p className="saved-drawer-recording-note" role="status">
                    Recording — use the bar above the toolbar to stop &amp; save or discard.
                  </p>
                )}
                {onSaveCurrentRoute && (
                  <button type="button" className="saved-drawer-save-current" onClick={onSaveCurrentRoute}>
                    Save active route
                  </button>
                )}
                <p className="saved-drawer-pane__subhead">Your routes</p>
                <ul className="saved-drawer-list saved-drawer-list--embedded">
                  {savedRoutes.length === 0 && <li className="saved-drawer-empty">No saved routes yet.</li>}
                  {savedRoutes.map((r) => (
                    <SavedRouteRow
                      key={r.id}
                      route={r}
                      onGo={onGoSavedRoute}
                      onRename={onRenameSavedRoute}
                      onDelete={onDeleteSavedRoute}
                    />
                  ))}
                </ul>
                </div>
              </div>
            </section>

            <section className="saved-drawer-pane" aria-labelledby="saved-frequent-heading">
              <div className="saved-drawer-pane__card">
                <header className="saved-drawer-pane__chrome saved-drawer-pane__chrome--inline">
                  <div className="saved-drawer-pane__title-stack">
                    <p id="saved-frequent-heading" className="saved-drawer-section-label">
                      Frequent routes
                    </p>
                    <p className="saved-drawer-pane__kicker">Repeat trips detected on this device.</p>
                  </div>
                  <span className="saved-drawer-pane__badge">Plus</span>
                </header>
                <div
                  className="saved-drawer-pane__scroll saved-drawer-pane__scroll--frequent"
                  role="region"
                  aria-label="Frequent route learning and suggestions"
                >
                {!payFrequentRoutes && (
                  <div className="saved-drawer-frequent-upsell">
                    <p className="saved-drawer-frequent-lead">
                      <strong>Plus</strong> can notice trips you drive often and suggest them here. Everything stays on this
                      device.
                    </p>
                    <p className="saved-drawer-route-hint saved-drawer-frequent-meta">
                      Production: subscribe or set <code className="saved-drawer-code">VITE_PAY_TIER=plus</code>. Dev is
                      usually Plus; to preview this screen set{" "}
                      <code className="saved-drawer-code">stormpath-pay-tier-override</code> to{" "}
                      <code className="saved-drawer-code">free</code>. See <code className="saved-drawer-code">docs/PAY_TIERS.md</code>.
                    </p>
                  </div>
                )}
                {payFrequentRoutes && (
                  <>
                    <label className="saved-drawer-toggle saved-drawer-toggle--learn">
                      <input
                        type="checkbox"
                        checked={frequentRoutesLearnEnabled}
                        onChange={(e) => onFrequentRoutesLearnEnabled(e.target.checked)}
                      />
                      <span>
                        <strong>Learn repeated trips</strong> on this device — detects similar drives for suggestions
                        below, saves sparse GPS for your usual area (map framing + search ranking), optional cyan trail in
                        About.
                      </span>
                    </label>
                    <p className="saved-drawer-route-hint saved-drawer-route-hint--tight">
                      After you drive a similar path at least twice while the app is open, a row appears below. Learning pauses
                      when you leave the tab.
                    </p>
                    <p className="saved-drawer-pane__subhead">Suggestions</p>
                    <ul className="saved-drawer-list saved-drawer-list--embedded">
                      {frequentRouteSuggestions.length === 0 && (
                        <li className="saved-drawer-empty">
                          No suggestions yet. Turn learning on and drive the same commute or errand route twice.
                        </li>
                      )}
                      {frequentRouteSuggestions.map((c) => (
                        <li key={c.id} className="saved-drawer-row saved-drawer-row--tile saved-drawer-row--learn">
                          <div className="saved-drawer-tile-head">
                            <span className="saved-drawer-tile-title">Similar trip · {c.count}×</span>
                            <p className="saved-drawer-tile-sub saved-drawer-learn-meta">
                              Last:{" "}
                              {new Date(c.lastSeen).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                            </p>
                          </div>
                          <button type="button" className="saved-drawer-tile-primary" onClick={() => onTryFrequentRoute(c)}>
                            Use suggestion
                          </button>
                          <div className="saved-drawer-tile-meta" role="group" aria-label="Suggestion actions">
                            <button type="button" className="saved-drawer-tile-link" onClick={() => onSaveFrequentRoute(c)}>
                              Save as route
                            </button>
                            <span className="saved-drawer-tile-meta-sep" aria-hidden>
                              ·
                            </span>
                            <button
                              type="button"
                              className="saved-drawer-tile-link danger"
                              onClick={() => onDismissFrequentRoute(c.id)}
                            >
                              Dismiss
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}

/** One-line coordinates (no geocode — data is only lat/lng). */
function formatLngLatLine(lngLat: LngLat): string {
  const lng = lngLat[0]!;
  const lat = lngLat[1]!;
  const ns = lat >= 0 ? "N" : "S";
  const ew = lng >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)}° ${ns}, ${Math.abs(lng).toFixed(4)}° ${ew}`;
}

function SavedRow({
  place,
  onGo,
  onRename,
  onDelete,
}: {
  place: SavedPlace;
  onGo: (lngLat: LngLat, label: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(place.name);

  useEffect(() => {
    setDraft(place.name);
  }, [place.name]);

  const commit = () => {
    onRename(place.id, draft);
    setEditing(false);
  };

  return (
    <li className="saved-drawer-row saved-drawer-row--tile">
      {editing ? (
        <div className="saved-drawer-tile-edit">
          <label className="saved-drawer-tile-label" htmlFor={`saved-place-edit-${place.id}`}>
            Place name
          </label>
          <div className="saved-drawer-edit saved-drawer-edit--tile">
            <input
              id={`saved-place-edit-${place.id}`}
              className="saved-drawer-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
                if (e.key === "Escape") {
                  setDraft(place.name);
                  setEditing(false);
                }
              }}
              aria-label="Place name"
            />
            <button type="button" className="saved-drawer-mini" onClick={commit}>
              Save
            </button>
          </div>
          <button type="button" className="saved-drawer-tile-link" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <>
          <div className="saved-drawer-tile-head">
            <span className="saved-drawer-tile-title">{place.name}</span>
            <p className="saved-drawer-tile-coords" title="Saved pin location (no street lookup)">
              {formatLngLatLine(place.lngLat)}
            </p>
          </div>
          <button
            type="button"
            className="saved-drawer-tile-primary"
            onClick={() => onGo(place.lngLat, place.name)}
          >
            Set destination and plan route
          </button>
          <div className="saved-drawer-tile-meta" role="group" aria-label="Place actions">
            <button type="button" className="saved-drawer-tile-link" onClick={() => setEditing(true)}>
              Edit name
            </button>
            <span className="saved-drawer-tile-meta-sep" aria-hidden>
              ·
            </span>
            <button type="button" className="saved-drawer-tile-link danger" onClick={() => onDelete(place.id)}>
              Remove
            </button>
          </div>
        </>
      )}
    </li>
  );
}

function SavedRouteRow({
  route,
  onGo,
  onRename,
  onDelete,
}: {
  route: SavedRoute;
  onGo: (r: SavedRoute, opts?: { reverse?: boolean }) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(route.name);
  const nPts = route.geometry.length;

  useEffect(() => {
    setDraft(route.name);
  }, [route.name]);

  const commit = () => {
    onRename(route.id, draft);
    setEditing(false);
  };

  return (
    <li className="saved-drawer-row saved-drawer-row--tile">
      {editing ? (
        <div className="saved-drawer-tile-edit">
          <label className="saved-drawer-tile-label" htmlFor={`saved-route-edit-${route.id}`}>
            Route label
          </label>
          <div className="saved-drawer-edit saved-drawer-edit--tile">
            <input
              id={`saved-route-edit-${route.id}`}
              className="saved-drawer-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
                if (e.key === "Escape") {
                  setDraft(route.name);
                  setEditing(false);
                }
              }}
              aria-label="Route name"
            />
            <button type="button" className="saved-drawer-mini" onClick={commit}>
              Save
            </button>
          </div>
          <button type="button" className="saved-drawer-tile-link" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <>
          <div className="saved-drawer-tile-head">
            <span className="saved-drawer-tile-title">{route.name}</span>
            <p className="saved-drawer-tile-sub">
              To <strong>{route.destinationLabel}</strong>
              {nPts >= 2 ? (
                <span className="saved-drawer-tile-sub-meta"> · {nPts.toLocaleString()} points on path</span>
              ) : null}
            </p>
            <p className="saved-drawer-tile-coords" title="Route end coordinates">
              {formatLngLatLine(route.destinationLngLat)}
            </p>
          </div>
          <button type="button" className="saved-drawer-tile-primary" onClick={() => onGo(route)}>
            Use this saved route
          </button>
          <button
            type="button"
            className="saved-drawer-tile-secondary"
            title="Same shape on the map, opposite direction — the old destination becomes your start."
            onClick={() => onGo(route, { reverse: true })}
          >
            Reverse direction
          </button>
          <div className="saved-drawer-tile-meta" role="group" aria-label="Route actions">
            <button type="button" className="saved-drawer-tile-link" onClick={() => setEditing(true)}>
              Edit name
            </button>
            <span className="saved-drawer-tile-meta-sep" aria-hidden>
              ·
            </span>
            <button type="button" className="saved-drawer-tile-link danger" onClick={() => onDelete(route.id)}>
              Remove
            </button>
          </div>
        </>
      )}
    </li>
  );
}
