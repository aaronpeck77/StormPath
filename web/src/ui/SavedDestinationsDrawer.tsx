import { useEffect, useState } from "react";
import type { SavedPlace } from "../nav/savedPlaces";
import type { SavedRoute } from "../nav/savedRoutes";
import type { LngLat } from "../nav/types";
import type { FrequentRouteCluster } from "../frequentRoutes/types";

/* The drawer is a full-screen sheet with a "home" landing page and three drill-in pages
 * (Places / Saved routes / Frequent routes). Each drill-in page gets the entire screen to
 * itself so the rows have plenty of room to read at a glance, and the previous nested-scroll
 * problem (three crammed sections sharing 88vh) goes away. */
type DrawerView = "home" | "places" | "routes" | "frequent";

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
  onSaveCurrentLocation: (() => void) | null;
  currentLocationLabel: string | null;
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
  onSaveCurrentLocation,
  currentLocationLabel,
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
  /* Drill-in navigation. Resets to "home" each time the drawer opens so users always land
   * on the section index instead of wherever they were last time. */
  const [view, setView] = useState<DrawerView>("home");
  useEffect(() => {
    if (open) setView("home");
  }, [open]);

  if (!open) return null;

  const headerTitle =
    view === "home"
      ? "Saved"
      : view === "places"
        ? "Places"
        : view === "routes"
          ? "Saved routes"
          : "Frequent routes";

  const placeCount = places.length;
  const routeCount = savedRoutes.length;
  const frequentCount = payFrequentRoutes ? frequentRouteSuggestions.length : 0;

  return (
    <>
      <div className="saved-drawer-scrim" role="presentation" onClick={onClose} />
      <div className="saved-drawer saved-drawer--full" role="dialog" aria-labelledby="saved-drawer-title">
        <div className="saved-drawer-head">
          {view !== "home" && (
            <button
              type="button"
              className="saved-drawer-back"
              onClick={() => setView("home")}
              aria-label="Back to Saved"
              title="Back"
            >
              ‹
            </button>
          )}
          <h2 id="saved-drawer-title" className="saved-drawer-title">
            {headerTitle}
          </h2>
          <button type="button" className="saved-drawer-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="saved-drawer-body saved-drawer-body--full">
          {view === "home" && (
            <div className="saved-drawer-home">
              <div className="saved-drawer-home-panel saved-drawer-home-panel--map">
                <label className="saved-drawer-toggle saved-drawer-toggle--panel">
                  <input
                    type="checkbox"
                    checked={showOnMap}
                    onChange={(e) => onToggleShowOnMap(e.target.checked)}
                  />
                  <span>Show place pins on map</span>
                </label>
              </div>

              <ul className="saved-drawer-home-list" role="list">
                <li className="saved-drawer-home-section saved-drawer-home-section--places">
                  <h3 className="saved-drawer-home-section__title">Places</h3>
                  {onSaveCurrentLocation || (onSaveCurrent && currentDestLngLat) ? (
                    <div className="saved-drawer-home-section__actions">
                      {onSaveCurrentLocation ? (
                        <button
                          type="button"
                          className="saved-drawer-save-current saved-drawer-save-current--home saved-drawer-save-current--location"
                          onClick={onSaveCurrentLocation}
                        >
                          Save current location
                          {currentLocationLabel && currentLocationLabel !== "Your location"
                            ? ` (${truncateDrawerLabel(currentLocationLabel)})`
                            : ""}
                        </button>
                      ) : null}
                      {onSaveCurrent && currentDestLngLat ? (
                        <button
                          type="button"
                          className="saved-drawer-save-current saved-drawer-save-current--home"
                          onClick={onSaveCurrent}
                        >
                          Save destination
                          {currentDestLabel ? ` (${truncateDrawerLabel(currentDestLabel)})` : ""}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  <HomeTile
                    label="Places"
                    count={placeCount}
                    hint="Saved pins on the map — tap one to set it as a destination."
                    onClick={() => setView("places")}
                  />
                </li>
                <li className="saved-drawer-home-section saved-drawer-home-section--routes">
                  <h3 className="saved-drawer-home-section__title">Saved routes</h3>
                  {onSaveCurrentRoute || onStartRecordingPath || recordingActive ? (
                    <div className="saved-drawer-home-section__actions">
                      {onSaveCurrentRoute ? (
                        <button
                          type="button"
                          className="saved-drawer-save-current saved-drawer-save-current--home"
                          onClick={onSaveCurrentRoute}
                        >
                          Save route
                        </button>
                      ) : null}
                      {onStartRecordingPath ? (
                        <button
                          type="button"
                          className="saved-drawer-save-current saved-drawer-save-current--record saved-drawer-save-current--home"
                          onClick={onStartRecordingPath}
                        >
                          Record driven path (GPS)
                        </button>
                      ) : null}
                      {recordingActive ? (
                        <p className="saved-drawer-recording-note saved-drawer-recording-note--home" role="status">
                          Recording — use the bar above the toolbar to stop &amp; save or discard.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  <HomeTile
                    label="Saved routes"
                    count={routeCount}
                    hint="Full driven paths you can replay or reverse."
                    onClick={() => setView("routes")}
                  />
                </li>
                <li className="saved-drawer-home-section saved-drawer-home-section--frequent">
                  <h3 className="saved-drawer-home-section__title">Frequent routes</h3>
                  <HomeTile
                    label="Frequent routes"
                    count={frequentCount}
                    hint={
                      payFrequentRoutes
                        ? "Repeat trips detected on this device."
                        : "Plus — repeat-trip learning and suggestions."
                    }
                    badge={payFrequentRoutes ? null : "Plus"}
                    onClick={() => setView("frequent")}
                  />
                </li>
              </ul>
            </div>
          )}

          {view === "places" && (
            <section className="saved-drawer-section" aria-label="Saved places">
              <p className="saved-drawer-section-kicker">Tap any place to set it as your destination and plan a route.</p>
              <ul className="saved-drawer-list saved-drawer-list--full">
                {places.length === 0 && (
                  <li className="saved-drawer-empty">
                    No saved places yet. Tap ★ and use <strong>Save current location</strong> for where you
                    are now, or set a map destination and use <strong>Save destination</strong> on the Saved
                    home screen.
                  </li>
                )}
                {places.map((p) => (
                  <SavedRow key={p.id} place={p} onGo={onGo} onRename={onRename} onDelete={onDelete} />
                ))}
              </ul>
            </section>
          )}

          {view === "routes" && (
            <section className="saved-drawer-section" aria-label="Saved routes">
              <p className="saved-drawer-section-kicker">
                Use <strong>Save route</strong> or <strong>Record driven path</strong> on the Saved home screen when you
                have a trip on the map. Use <strong>Rev</strong> on a saved route to flip direction.
              </p>
              <p className="saved-drawer-pane__subhead">Your routes</p>
              <ul className="saved-drawer-list saved-drawer-list--full">
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
            </section>
          )}

          {view === "frequent" && (
            <section className="saved-drawer-section" aria-label="Frequent routes">
              {!payFrequentRoutes && (
                <div className="saved-drawer-frequent-upsell">
                  <p className="saved-drawer-frequent-lead">
                    <strong>Plus</strong> can notice trips you drive often and suggest them here. Everything stays on
                    this device.
                  </p>
                  <p className="saved-drawer-route-hint saved-drawer-frequent-meta">
                    Production: subscribe or set <code className="saved-drawer-code">VITE_PAY_TIER=plus</code>. Dev is
                    usually Plus; to preview this screen set{" "}
                    <code className="saved-drawer-code">stormpath-pay-tier-override</code> to{" "}
                    <code className="saved-drawer-code">free</code>. See{" "}
                    <code className="saved-drawer-code">docs/PAY_TIERS.md</code>.
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
                    After you drive a similar path at least twice while the app is open, a row appears below. Learning
                    pauses when you leave the tab.
                  </p>
                  <p className="saved-drawer-pane__subhead">Suggestions</p>
                  <ul className="saved-drawer-list saved-drawer-list--full">
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
                        <button
                          type="button"
                          className="saved-drawer-tile-primary"
                          onClick={() => onTryFrequentRoute(c)}
                        >
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
            </section>
          )}
        </div>
      </div>
    </>
  );
}

function truncateDrawerLabel(label: string, maxLen = 40): string {
  const t = label.trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen - 1)}…`;
}

/** Big tappable home tile that drills into one of the three sections. */
function HomeTile({
  label,
  count,
  hint,
  badge,
  onClick,
}: {
  label: string;
  count: number;
  hint: string;
  badge?: string | null;
  onClick: () => void;
}) {
  return (
    <button type="button" className="saved-drawer-home-tile" onClick={onClick}>
      <span className="saved-drawer-home-tile__row">
        <span className="saved-drawer-home-tile__label">{label}</span>
        {badge ? (
          <span className="saved-drawer-home-tile__badge">{badge}</span>
        ) : (
          <span className="saved-drawer-home-tile__count">{count}</span>
        )}
        <span className="saved-drawer-home-tile__chevron" aria-hidden>
          ›
        </span>
      </span>
      <span className="saved-drawer-home-tile__hint">{hint}</span>
    </button>
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
