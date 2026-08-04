import { useEffect, useState, type ReactNode } from "react";
import type { SavedPlace } from "../nav/savedPlaces";
import type { SavedRoute } from "../nav/savedRoutes";
import type { LngLat } from "../nav/types";
import { loadRecentDestinations, type RecentDestination } from "../recentSearches";

type DrawerView = "home" | "places" | "routes" | "recent";

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
  /** Basic tier caps — null = unlimited (Plus). */
  maxSavedPlaces?: number | null;
  maxSavedRoutes?: number | null;
  canSavePlace?: boolean;
  canSaveRoute?: boolean;
};

function formatLngLatLine(lngLat: LngLat): string {
  const lng = lngLat[0]!;
  const lat = lngLat[1]!;
  const ns = lat >= 0 ? "N" : "S";
  const ew = lng >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)}° ${ns}, ${Math.abs(lng).toFixed(4)}° ${ew}`;
}

function formatRelativeWhen(ms: number): string {
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

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
  currentLocationLabel: _currentLocationLabel,
  currentDestLabel: _currentDestLabel,
  currentDestLngLat,
  savedRoutes,
  onSaveCurrentRoute,
  onGoSavedRoute,
  onRenameSavedRoute,
  onDeleteSavedRoute,
  onStartRecordingPath,
  recordingActive,
  maxSavedPlaces = null,
  maxSavedRoutes = null,
  canSavePlace = true,
  canSaveRoute = true,
}: Props) {
  const [view, setView] = useState<DrawerView>("home");
  const [recentDestinations, setRecentDestinations] = useState<RecentDestination[]>([]);

  useEffect(() => {
    if (open) {
      setView("home");
      setRecentDestinations(loadRecentDestinations());
    }
  }, [open]);

  if (!open) return null;

  const headerTitle =
    view === "home"
      ? "Saved"
      : view === "places"
        ? "Saved places"
        : view === "routes"
          ? "Saved routes"
          : "Previous destinations";

  const placeLimitHint =
    maxSavedPlaces != null ? `Basic: up to ${maxSavedPlaces} places` : null;
  const routeLimitHint =
    maxSavedRoutes != null ? `Basic: up to ${maxSavedRoutes} saved routes` : null;

  return (
    <>
      <div className="saved-drawer-scrim" role="presentation" onClick={onClose} />
      <div className="saved-drawer saved-drawer--full" role="dialog" aria-labelledby="saved-drawer-title">
        <div className="saved-drawer-head">
          {view !== "home" ? (
            <button
              type="button"
              className="saved-drawer-back"
              onClick={() => setView("home")}
              aria-label="Back to Saved"
              title="Back"
            >
              ‹
            </button>
          ) : (
            <span className="saved-drawer-back-spacer" aria-hidden />
          )}
          <h2 id="saved-drawer-title" className="saved-drawer-title">
            {headerTitle}
          </h2>
          <button type="button" className="saved-drawer-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="saved-drawer-body saved-drawer-body--full">
          {view === "home" ? (
            <div className="saved-drawer-home">
              <label className="saved-drawer-map-toggle">
                <input
                  type="checkbox"
                  checked={showOnMap}
                  onChange={(e) => onToggleShowOnMap(e.target.checked)}
                />
                <span>Show place pins on map</span>
              </label>

              <ul className="saved-home-cards" role="list">
                <li>
                  <HomeCard
                    tone="places"
                    title="Saved places"
                    count={places.length}
                    summary="Pins you can set as a destination"
                    onOpen={() => setView("places")}
                  >
                    {onSaveCurrentLocation || (onSaveCurrent && currentDestLngLat) ? (
                      <div className="saved-home-card__actions">
                        {onSaveCurrentLocation ? (
                          <button
                            type="button"
                            className="saved-chip"
                            onClick={onSaveCurrentLocation}
                            disabled={!canSavePlace}
                            title={!canSavePlace ? placeLimitHint ?? undefined : undefined}
                          >
                            Save location
                          </button>
                        ) : null}
                        {onSaveCurrent && currentDestLngLat ? (
                          <button
                            type="button"
                            className="saved-chip"
                            onClick={onSaveCurrent}
                            disabled={!canSavePlace}
                            title={!canSavePlace ? placeLimitHint ?? undefined : undefined}
                          >
                            Save destination
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    {placeLimitHint ? <p className="saved-home-card__note">{placeLimitHint}</p> : null}
                  </HomeCard>
                </li>

                <li>
                  <HomeCard
                    tone="routes"
                    title="Saved routes"
                    count={savedRoutes.length}
                    summary="Full paths you can replay or reverse"
                    onOpen={() => setView("routes")}
                  >
                    {onSaveCurrentRoute || onStartRecordingPath || recordingActive ? (
                      <div className="saved-home-card__actions">
                        {onSaveCurrentRoute ? (
                          <button
                            type="button"
                            className="saved-chip"
                            onClick={onSaveCurrentRoute}
                            disabled={!canSaveRoute}
                            title={!canSaveRoute ? routeLimitHint ?? undefined : undefined}
                          >
                            Save route
                          </button>
                        ) : null}
                        {onStartRecordingPath ? (
                          <button
                            type="button"
                            className="saved-chip saved-chip--accent"
                            onClick={onStartRecordingPath}
                            disabled={!canSaveRoute}
                            title={!canSaveRoute ? routeLimitHint ?? undefined : undefined}
                          >
                            Record path
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    {recordingActive ? (
                      <p className="saved-home-card__note saved-home-card__note--live" role="status">
                        Recording — stop in the bar above the toolbar
                      </p>
                    ) : null}
                    {routeLimitHint ? <p className="saved-home-card__note">{routeLimitHint}</p> : null}
                  </HomeCard>
                </li>

                <li>
                  <HomeCard
                    tone="recent"
                    title="Previous destinations"
                    count={recentDestinations.length}
                    summary="Recent searches and destinations"
                    onOpen={() => setView("recent")}
                  />
                </li>
              </ul>
            </div>
          ) : null}

          {view === "places" ? (
            <section className="saved-list-page" aria-label="Saved places">
              <p className="saved-list-page__lead">Tap a place to plan a route there.</p>
              <ul className="saved-pick-list" role="list">
                {places.length === 0 ? (
                  <li className="saved-pick-empty">
                    No saved places yet. Use <strong>Save location</strong> or{" "}
                    <strong>Save destination</strong> on the Saved home screen.
                  </li>
                ) : (
                  places.map((p) => (
                    <SavedPlaceRow
                      key={p.id}
                      place={p}
                      onGo={onGo}
                      onRename={onRename}
                      onDelete={onDelete}
                    />
                  ))
                )}
              </ul>
            </section>
          ) : null}

          {view === "routes" ? (
            <section className="saved-list-page" aria-label="Saved routes">
              <p className="saved-list-page__lead">
                Tap <strong>Go</strong> to use a path, or <strong>Reverse</strong> to flip direction.
              </p>
              <ul className="saved-pick-list" role="list">
                {savedRoutes.length === 0 ? (
                  <li className="saved-pick-empty">
                    No saved routes yet. Use <strong>Save route</strong> or{" "}
                    <strong>Record path</strong> when you have a trip on the map.
                  </li>
                ) : (
                  savedRoutes.map((r) => (
                    <SavedRouteRow
                      key={r.id}
                      route={r}
                      onGo={onGoSavedRoute}
                      onRename={onRenameSavedRoute}
                      onDelete={onDeleteSavedRoute}
                    />
                  ))
                )}
              </ul>
            </section>
          ) : null}

          {view === "recent" ? (
            <section className="saved-list-page" aria-label="Previous destinations">
              <p className="saved-list-page__lead">Tap to set as destination and plan a route.</p>
              <ul className="saved-pick-list" role="list">
                {recentDestinations.length === 0 ? (
                  <li className="saved-pick-empty">
                    Places you search or set as a destination show up here.
                  </li>
                ) : (
                  recentDestinations.map((r) => (
                    <li
                      key={`${r.placeName}-${r.lngLat[0]}-${r.lngLat[1]}-${r.savedAtMs}`}
                      className="saved-pick-row"
                    >
                      <button
                        type="button"
                        className="saved-pick-row__main"
                        onClick={() => onGo(r.lngLat, r.placeName)}
                      >
                        <span className="saved-pick-row__kind saved-pick-row__kind--recent">
                          Recent
                        </span>
                        <span className="saved-pick-row__title">{r.placeName}</span>
                        <span className="saved-pick-row__meta">
                          {formatRelativeWhen(r.savedAtMs)} · {formatLngLatLine(r.lngLat)}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="saved-pick-go"
                        onClick={() => onGo(r.lngLat, r.placeName)}
                      >
                        Go
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </>
  );
}

function HomeCard({
  tone,
  title,
  count,
  summary,
  onOpen,
  children,
}: {
  tone: "places" | "routes" | "recent";
  title: string;
  count: number;
  summary: string;
  onOpen: () => void;
  children?: ReactNode;
}) {
  return (
    <div className={`saved-home-card saved-home-card--${tone}`}>
      <div className="saved-home-card__body">
        <div className="saved-home-card__top">
          <span className="saved-home-card__title">{title}</span>
          <span className="saved-home-card__count">{count}</span>
        </div>
        <p className="saved-home-card__summary">{summary}</p>
        {children}
      </div>
      <div className="saved-home-card__footer">
        <button type="button" className="saved-home-card__open-btn" onClick={onOpen}>
          Open
        </button>
      </div>
    </div>
  );
}

function SavedPlaceRow({
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
    <li className="saved-pick-row">
      {editing ? (
        <div className="saved-pick-edit">
          <input
            className="saved-pick-edit__input"
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
            autoFocus
          />
          <button type="button" className="saved-pick-go" onClick={commit}>
            Save
          </button>
          <button type="button" className="saved-pick-link" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <>
          <button
            type="button"
            className="saved-pick-row__main"
            onClick={() => onGo(place.lngLat, place.name)}
          >
            <span className="saved-pick-row__kind saved-pick-row__kind--place">Place</span>
            <span className="saved-pick-row__title">{place.name}</span>
            <span className="saved-pick-row__meta">{formatLngLatLine(place.lngLat)}</span>
          </button>
          <button
            type="button"
            className="saved-pick-go"
            onClick={() => onGo(place.lngLat, place.name)}
          >
            Go
          </button>
          <div className="saved-pick-row__tools">
            <button type="button" className="saved-pick-link" onClick={() => setEditing(true)}>
              Rename
            </button>
            <button
              type="button"
              className="saved-pick-link saved-pick-link--danger"
              onClick={() => onDelete(place.id)}
            >
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
  const fromLabel = route.startLabel?.trim() || "Start";
  const toLabel = route.destinationLabel?.trim() || "Destination";

  useEffect(() => {
    setDraft(route.name);
  }, [route.name]);

  const commit = () => {
    onRename(route.id, draft);
    setEditing(false);
  };

  return (
    <li className="saved-pick-row">
      {editing ? (
        <div className="saved-pick-edit">
          <input
            className="saved-pick-edit__input"
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
            autoFocus
          />
          <button type="button" className="saved-pick-go" onClick={commit}>
            Save
          </button>
          <button type="button" className="saved-pick-link" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <>
          <button type="button" className="saved-pick-row__main" onClick={() => onGo(route)}>
            <span className="saved-pick-row__kind saved-pick-row__kind--route">Route</span>
            <span className="saved-pick-row__title">{route.name}</span>
            <span className="saved-pick-row__path">
              <span className="saved-pick-row__endpoint">{fromLabel}</span>
              <span className="saved-pick-row__arrow" aria-hidden>
                →
              </span>
              <span className="saved-pick-row__endpoint">{toLabel}</span>
            </span>
            <span className="saved-pick-row__meta">
              {nPts >= 2 ? `${nPts.toLocaleString()} points` : "Saved path"}
            </span>
          </button>
          <div className="saved-pick-row__route-actions">
            <button type="button" className="saved-pick-go" onClick={() => onGo(route)}>
              Go
            </button>
            <button
              type="button"
              className="saved-pick-go saved-pick-go--secondary"
              title="Same path, opposite direction"
              onClick={() => onGo(route, { reverse: true })}
            >
              Reverse
            </button>
          </div>
          <div className="saved-pick-row__tools">
            <button type="button" className="saved-pick-link" onClick={() => setEditing(true)}>
              Rename
            </button>
            <button
              type="button"
              className="saved-pick-link saved-pick-link--danger"
              onClick={() => onDelete(route.id)}
            >
              Remove
            </button>
          </div>
        </>
      )}
    </li>
  );
}
