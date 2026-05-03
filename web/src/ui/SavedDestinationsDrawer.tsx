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
              <div className="saved-drawer-pane__chrome">
                <p id="saved-places-heading" className="saved-drawer-section-label">
                  Places
                </p>
                {onSaveCurrent && currentDestLngLat && (
                  <button type="button" className="saved-drawer-save-current" onClick={onSaveCurrent}>
                    Save current destination
                    {currentDestLabel ? ` (${currentDestLabel})` : ""}
                  </button>
                )}
              </div>
              <div className="saved-drawer-pane__scroll">
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
            </section>

            <section className="saved-drawer-pane" aria-labelledby="saved-routes-heading">
              <div className="saved-drawer-pane__chrome">
                <p id="saved-routes-heading" className="saved-drawer-section-label">
                  Saved routes
                </p>
              </div>
              <div className="saved-drawer-pane__scroll">
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
            </section>

            <section className="saved-drawer-pane" aria-labelledby="saved-frequent-heading">
              <div className="saved-drawer-pane__chrome saved-drawer-pane__chrome--inline">
                <p id="saved-frequent-heading" className="saved-drawer-section-label">
                  Frequent routes
                </p>
                <span className="saved-drawer-pane__badge">Plus</span>
              </div>
              <div className="saved-drawer-pane__scroll saved-drawer-pane__scroll--frequent">
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
                        <li key={c.id} className="saved-drawer-row saved-drawer-row--learn">
                          <span className="saved-drawer-name">
                            Similar trip · {c.count}×
                            <span className="saved-drawer-learn-meta">
                              Last: {new Date(c.lastSeen).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                            </span>
                          </span>
                          <div className="saved-drawer-actions">
                            <button type="button" className="saved-drawer-mini" onClick={() => onTryFrequentRoute(c)}>
                              Use
                            </button>
                            <button type="button" className="saved-drawer-mini" onClick={() => onSaveFrequentRoute(c)}>
                              Save
                            </button>
                            <button
                              type="button"
                              className="saved-drawer-mini danger"
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
            </section>
          </div>
        </div>
      </div>
    </>
  );
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
    <li className="saved-drawer-row">
      {editing ? (
        <div className="saved-drawer-edit">
          <input
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
            OK
          </button>
        </div>
      ) : (
        <span className="saved-drawer-name">{place.name}</span>
      )}
      <div className="saved-drawer-actions">
        <button type="button" className="saved-drawer-mini" onClick={() => onGo(place.lngLat, place.name)}>
          Go
        </button>
        {!editing && (
          <button type="button" className="saved-drawer-mini" onClick={() => setEditing(true)}>
            Rename
          </button>
        )}
        <button type="button" className="saved-drawer-mini danger" onClick={() => onDelete(place.id)}>
          Delete
        </button>
      </div>
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

  useEffect(() => {
    setDraft(route.name);
  }, [route.name]);

  const commit = () => {
    onRename(route.id, draft);
    setEditing(false);
  };

  return (
    <li className="saved-drawer-row">
      {editing ? (
        <div className="saved-drawer-edit">
          <input
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
            OK
          </button>
        </div>
      ) : (
        <span className="saved-drawer-name">{route.name}</span>
      )}
      <div className="saved-drawer-actions">
        <button type="button" className="saved-drawer-mini" onClick={() => onGo(route)}>
          Use
        </button>
        <button
          type="button"
          className="saved-drawer-mini"
          title="Same path, opposite direction — destination becomes the original start"
          onClick={() => onGo(route, { reverse: true })}
        >
          Rev
        </button>
        {!editing && (
          <button type="button" className="saved-drawer-mini" onClick={() => setEditing(true)}>
            Rename
          </button>
        )}
        <button type="button" className="saved-drawer-mini danger" onClick={() => onDelete(route.id)}>
          Delete
        </button>
      </div>
    </li>
  );
}
