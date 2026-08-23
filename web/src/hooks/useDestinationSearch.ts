import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { SavedPlace } from "../nav/savedPlaces";
import { MAX_VIA_STOPS } from "../nav/routeWaypoints";
import type { ComputeRoutesFn } from "../nav/useComputeRoutes";
import type { LngLat } from "../nav/types";
import { loadRecentSearchSuggestions, recordRecentSearch } from "../recentSearches";
import {
  mapboxAutocomplete,
  mapboxGeocodeSearch,
  mapboxReverseGeocode,
} from "../services/mapboxGeocode";
import { geocodeCountriesForFix } from "../services/continents";
import {
  mapboxSearchBoxSuggest,
  mapboxSearchBoxRetrieve,
  mintSearchBoxSessionToken,
} from "../services/mapboxSearchBox";
import { useTripPlanStore } from "../state/tripPlanStore";
import { useUiStore } from "../state/uiStore";
import { formatDistanceShort } from "../utils/formatDistance";
import { isNarrowPhoneViewport } from "../ui/mapFitLogic";
import type { SearchSuggestion } from "../ui/SearchBar";

export interface UseDestinationSearchDeps {
  userLngLat: LngLat | null;
  userLngLatRef: RefObject<LngLat | null>;
  locationError: string | null;
  mapboxToken: string;
  computeRoutes: ComputeRoutesFn;
  navigationStarted: boolean;
  planRoutesLength: number;
  rankSearchSuggestionsWithTrail: (items: SearchSuggestion[]) => SearchSuggestion[];
  activityTrailTick: number;
  savedPlaces: SavedPlace[];
  setSavedDrawerOpen: (open: boolean) => void;
  setFitTrigger: (updater: (prev: number) => number) => void;
  setTapHint: (msg: string | null) => void;
  setRouting: (busy: boolean) => void;
  setRouteError: (msg: string | null) => void;
}

export function useDestinationSearch(deps: UseDestinationSearchDeps) {
  const {
    userLngLat,
    userLngLatRef,
    locationError,
    mapboxToken,
    computeRoutes,
    navigationStarted,
    planRoutesLength,
    rankSearchSuggestionsWithTrail,
    activityTrailTick,
    savedPlaces,
    setSavedDrawerOpen,
    setFitTrigger,
    setTapHint,
    setRouting,
    setRouteError,
  } = deps;

  const destLngLat = useTripPlanStore((s) => s.destLngLat);
  const setDestLngLat = useTripPlanStore((s) => s.setDestLngLat);
  const setDestinationLabel = useTripPlanStore((s) => s.setDestinationLabel);
  const setViaStops = useTripPlanStore((s) => s.setViaStops);
  const setActiveViaIndex = useTripPlanStore((s) => s.setActiveViaIndex);
  const setViewMode = useTripPlanStore((s) => s.setViewMode);
  const searchExpanded = useUiStore((s) => s.searchExpanded);
  const setSearchExpanded = useUiStore((s) => s.setSearchExpanded);
  const searchEditing = useUiStore((s) => s.searchEditing);
  const setSearchEditing = useUiStore((s) => s.setSearchEditing);

  const [addingViaStop, setAddingViaStop] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [allowAutocomplete, setAllowAutocomplete] = useState(true);
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  /** Invalidates in-flight autocomplete when the query changes so stale results do not flash in. */
  const searchAutocompleteSeqRef = useRef(0);
  /** Mapbox Search Box session token. One UUID is minted lazily on first autocomplete and reused
   * across every keystroke + the final /retrieve so suggest+retrieve are billed as a single
   * transaction. Reset to null when the user closes the search bar or commits a destination. */
  const searchBoxSessionTokenRef = useRef<string | null>(null);
  const ensureSearchBoxSessionToken = useCallback((): string => {
    if (!searchBoxSessionTokenRef.current) {
      searchBoxSessionTokenRef.current = mintSearchBoxSessionToken();
    }
    return searchBoxSessionTokenRef.current;
  }, []);
  const resetSearchBoxSessionToken = useCallback(() => {
    searchBoxSessionTokenRef.current = null;
  }, []);
  /* Whenever the search bar collapses, end the current Search Box session so the next typing
   * session starts fresh (and Mapbox bills it independently). */
  useEffect(() => {
    if (!searchExpanded) searchBoxSessionTokenRef.current = null;
  }, [searchExpanded]);
  /** Lets suggestion taps win over blur before parent clears the list. */
  const searchBlurClearTimerRef = useRef<number | null>(null);
  /** Several geocode hits (business + city, "coffee", etc.) — map pins + list until user picks one. */
  const [searchPickHits, setSearchPickHits] = useState<SearchSuggestion[] | null>(null);
  const searchPickHitsRef = useRef<SearchSuggestion[] | null>(null);
  searchPickHitsRef.current = searchPickHits;
  /** Query string that produced {@link searchPickHits}; cleared when the user edits the field. */
  const searchPickQueryRef = useRef<string | null>(null);

  const applyTripPlacePick = useCallback(
    async (lngLat: LngLat, label: string, mode: "destination" | "via") => {
      if (mode === "via") {
        const finalDest = useTripPlanStore.getState().destLngLat;
        const finalLabel = useTripPlanStore.getState().destinationLabel;
        if (!finalDest) {
          setTapHint("Set your final destination first, then add stops.");
          window.setTimeout(() => setTapHint(null), 5000);
          setAddingViaStop(false);
          return;
        }
        const prev = useTripPlanStore.getState().viaStops;
        if (prev.length >= MAX_VIA_STOPS) {
          setAddingViaStop(false);
          return;
        }
        setViaStops([...prev, { lngLat, label }]);
        setAddingViaStop(false);
        await computeRoutes(finalDest, finalLabel.trim() || "Destination", {
          preserveNavigation: navigationStarted,
        });
        return;
      }
      setViaStops([]);
      setActiveViaIndex(0);
      setAddingViaStop(false);
      setDestLngLat(lngLat);
      setDestinationLabel(label);
      setViewMode("route");
      setSearchExpanded(false);
      await computeRoutes(lngLat, label);
    },
    [
      computeRoutes,
      navigationStarted,
      setActiveViaIndex,
      setDestLngLat,
      setDestinationLabel,
      setSearchExpanded,
      setTapHint,
      setViaStops,
      setViewMode,
    ]
  );

  const handleRemoveViaStop = useCallback(
    (index: number) => {
      const finalDest = useTripPlanStore.getState().destLngLat;
      const finalLabel = useTripPlanStore.getState().destinationLabel;
      const next = useTripPlanStore.getState().viaStops.filter((_, i) => i !== index);
      setViaStops(next);
      setActiveViaIndex((i) => Math.min(i, Math.max(0, next.length)));
      if (finalDest) {
        void computeRoutes(finalDest, finalLabel.trim() || "Destination", {
          preserveNavigation: navigationStarted,
        });
      }
    },
    [computeRoutes, navigationStarted, setActiveViaIndex, setViaStops]
  );

  const handleMapClick = useCallback(
    async (lng: number, lat: number) => {
      if (navigationStarted && planRoutesLength > 0) {
        setTapHint("Stop navigation first to pick a new destination on the map.");
        window.setTimeout(() => setTapHint(null), 5000);
        return;
      }
      if (!userLngLat) {
        setTapHint(
          locationError ??
            "Turn on location first — we need your position to build a route."
        );
        window.setTimeout(() => setTapHint(null), 8000);
        return;
      }
      setAllowAutocomplete(false);
      setSuggestions([]);
      setSuggestLoading(false);
      const end: [number, number] = [lng, lat];
      const pinLabel = `Pin · ${lat.toFixed(3)}°, ${lng.toFixed(3)}°`;
      const pickMode =
        addingViaStop && useTripPlanStore.getState().destLngLat ? "via" : "destination";
      setSearchText(pinLabel);
      setViewMode("route");
      setFitTrigger((n) => n + 1);
      setSearchExpanded(false);

      if (pickMode === "via") {
        void applyTripPlacePick(end, pinLabel, "via");
      } else {
        setDestinationLabel(pinLabel);
        void applyTripPlacePick(end, pinLabel, "destination");
      }

      if (mapboxToken) {
        void mapboxReverseGeocode(lng, lat, mapboxToken)
          .then((rev) => {
            if (!rev?.placeName) return;
            if (pickMode === "via") {
              const stops = useTripPlanStore.getState().viaStops;
              const last = stops[stops.length - 1];
              if (!last) return;
              setViaStops(stops.slice(0, -1).concat({ ...last, label: rev.placeName }));
            } else {
              setDestinationLabel(rev.placeName);
              setSearchText(rev.placeName);
              recordRecentSearch(rev.placeName, end);
            }
          })
          .catch(() => {
            /* keep pin label */
          });
      } else if (pickMode === "destination") {
        recordRecentSearch(pinLabel, end);
      }
    },
    [userLngLat, applyTripPlacePick, mapboxToken, locationError, recordRecentSearch, navigationStarted, planRoutesLength, addingViaStop, setViaStops]
  );

  const handleSavedPlaceNavigate = useCallback(
    (lngLat: [number, number], label: string) => {
      if (!userLngLat) {
        setTapHint(
          locationError ?? "Turn on location first — allow it for this site in browser settings."
        );
        window.setTimeout(() => setTapHint(null), 8000);
        return;
      }
      recordRecentSearch(label, lngLat);
      setAllowAutocomplete(false);
      setSuggestions([]);
      setSearchExpanded(false);
      setSearchText(label);
      setSavedDrawerOpen(false);
      setViewMode("route");
      const pickMode =
        addingViaStop && useTripPlanStore.getState().destLngLat ? "via" : "destination";
      if (pickMode === "destination") setDestinationLabel(label);
      void (async () => {
        await applyTripPlacePick(lngLat, label, pickMode);
        /* Drawer close changes map chrome size — refit once layout settles so the full
         * route fills the screen the same as any other planned trip. */
        setFitTrigger((n) => n + 1);
        window.setTimeout(() => setFitTrigger((n) => n + 1), 280);
      })();
    },
    [
      userLngLat,
      applyTripPlacePick,
      locationError,
      recordRecentSearch,
      addingViaStop,
      setFitTrigger,
      setViewMode,
    ]
  );

  const handleSavedMarkerClick = useCallback(
    (id: string) => {
      const p = savedPlaces.find((x) => x.id === id);
      if (!p) return;
      handleSavedPlaceNavigate(p.lngLat, p.name);
    },
    [savedPlaces, handleSavedPlaceNavigate]
  );

  const handlePickSuggestion = useCallback(
    async (hit: SearchSuggestion) => {
      if (!userLngLat) {
        setTapHint(
          locationError ?? "Turn on location before picking a place."
        );
        window.setTimeout(() => setTapHint(null), 8000);
        return;
      }
      let lngLat = hit.lngLat;
      let placeName = hit.placeName;
      /* Search Box suggestions don't carry coordinates — resolve them now via /retrieve so the
       * destination flow downstream sees a real lng/lat. We reuse the same session token that
       * was minted for /suggest so Mapbox bills the autocomplete + retrieve as one transaction. */
      if (hit.mapboxId) {
        if (!mapboxToken) {
          setTapHint("Mapbox token needed to look up that place.");
          window.setTimeout(() => setTapHint(null), 4000);
          return;
        }
        setRouting(true);
        try {
          const sessionToken = ensureSearchBoxSessionToken();
          const retrieved = await mapboxSearchBoxRetrieve(hit.mapboxId, mapboxToken, sessionToken);
          if (!retrieved) {
            setTapHint("Couldn't fetch that place's coordinates. Try another match or hit search.");
            window.setTimeout(() => setTapHint(null), 6000);
            return;
          }
          lngLat = retrieved.lngLat;
          placeName = retrieved.placeName;
        } catch {
          setTapHint("Couldn't fetch that place's coordinates. Try another match or hit search.");
          window.setTimeout(() => setTapHint(null), 6000);
          return;
        } finally {
          setRouting(false);
        }
        /* Session is consumed on retrieve — start a fresh token next time the user types. */
        resetSearchBoxSessionToken();
      }
      setSearchPickHits(null);
      searchPickQueryRef.current = null;
      recordRecentSearch(placeName, lngLat);
      setAllowAutocomplete(true);
      setSuggestions([]);
      setSearchText(placeName);
      const pickMode =
        addingViaStop && useTripPlanStore.getState().destLngLat ? "via" : "destination";
      if (pickMode === "destination") setDestinationLabel(placeName);
      await applyTripPlacePick(lngLat, placeName, pickMode);
    },
    [
      userLngLat,
      applyTripPlacePick,
      locationError,
      recordRecentSearch,
      mapboxToken,
      ensureSearchBoxSessionToken,
      resetSearchBoxSessionToken,
      addingViaStop,
    ]
  );

  const handleSearchPickFromMap = useCallback(
    (id: string) => {
      const hit = searchPickHitsRef.current?.find((h) => h.id === id);
      if (hit) void handlePickSuggestion(hit);
    },
    [handlePickSuggestion]
  );

  const handleSearch = useCallback(async () => {
    const q = searchText.trim();
    if (!q) return;
    if (!userLngLat) {
      setTapHint(
        locationError ?? "Turn on location before searching — or use HTTPS if you opened this page from a home Wi‑Fi address."
      );
      window.setTimeout(() => setTapHint(null), 8000);
      return;
    }
    if (!mapboxToken) {
      setTapHint("Mapbox token needed for address search.");
      window.setTimeout(() => setTapHint(null), 4000);
      return;
    }
    setSearchPickHits(null);
    searchPickQueryRef.current = null;
    setRouting(true);
    setRouteError(null);
    let hits: SearchSuggestion[] = [];
    try {
      hits = await mapboxGeocodeSearch(q, mapboxToken, {
        proximity: userLngLat ?? undefined,
        limit: 12,
        /* Scope to the user's continent so a typo doesn't surface London/Moscow/Sydney for a US
         * driver. `null` (no GPS yet, or ocean cell) → undefined → no filter (full world). */
        countries: geocodeCountriesForFix(userLngLat) ?? undefined,
      });
    } catch {
      setRouteError("Search failed. Check the signal and try again.");
      return;
    } finally {
      setRouting(false);
    }
    if (hits.length === 0) {
      setRouteError("No results for that search.");
      return;
    }
    if (hits.length === 1) {
      const hit = hits[0]!;
      recordRecentSearch(hit.placeName, hit.lngLat);
      setAllowAutocomplete(true);
      setSearchText(hit.placeName);
      const pickMode =
        addingViaStop && useTripPlanStore.getState().destLngLat ? "via" : "destination";
      if (pickMode === "destination") setDestinationLabel(hit.placeName);
      await applyTripPlacePick(hit.lngLat, hit.placeName, pickMode);
      return;
    }
    searchPickQueryRef.current = q;
    setSearchPickHits(hits);
    setSuggestions(hits);
    setAllowAutocomplete(true);
    setTapHint(`${hits.length} matches — tap an orange pin or a result below.`);
    window.setTimeout(() => setTapHint(null), 10_000);
  }, [searchText, userLngLat, mapboxToken, computeRoutes, locationError, recordRecentSearch]);

  const searchPickMarkersForMap = useMemo((): { id: string; lngLat: LngLat; label: string }[] | null => {
    if (!searchPickHits || searchPickHits.length < 2) return null;
    return searchPickHits.map((h) => ({ id: h.id, lngLat: h.lngLat, label: h.placeName }));
  }, [searchPickHits]);

  /** Drop map pins if the user edits the query after a multi-result search. */
  useEffect(() => {
    const pinned = searchPickQueryRef.current;
    if (pinned == null) return;
    if (searchText.trim() !== pinned) {
      setSearchPickHits(null);
      searchPickQueryRef.current = null;
    }
  }, [searchText]);

  /** Focus search: do not clear text (avoids compact/input flicker); compact chip uses its own reset. */
  const handleSearchFieldBeginEditing = useCallback(() => {
    if (searchBlurClearTimerRef.current) {
      window.clearTimeout(searchBlurClearTimerRef.current);
      searchBlurClearTimerRef.current = null;
    }
    setSearchEditing(true);
    const t = searchText.trim();
    if (isNarrowPhoneViewport() && t.length <= 1) {
      setSuggestions(rankSearchSuggestionsWithTrail(loadRecentSearchSuggestions()));
    }
    setSuggestLoading(false);
    setAllowAutocomplete(true);
  }, [searchText, rankSearchSuggestionsWithTrail]);

  const handleSearchFieldEndEditing = useCallback(() => {
    setSearchEditing(false);
    if (searchBlurClearTimerRef.current) {
      window.clearTimeout(searchBlurClearTimerRef.current);
    }
    searchBlurClearTimerRef.current = window.setTimeout(() => {
      searchBlurClearTimerRef.current = null;
      if (searchPickHitsRef.current && searchPickHitsRef.current.length >= 2) return;
      setSuggestions([]);
      setSuggestLoading(false);
    }, 280);
  }, []);

  const handleSearchCancelSuggestions = useCallback(() => {
    if (searchBlurClearTimerRef.current) {
      window.clearTimeout(searchBlurClearTimerRef.current);
      searchBlurClearTimerRef.current = null;
    }
    setSearchEditing(false);
    setSearchPickHits(null);
    searchPickQueryRef.current = null;
    setSuggestions([]);
    setSuggestLoading(false);
  }, []);

  /** Supervisor / hang recovery: drop in-flight autocomplete so a late .then cannot restick the spinner. */
  const abandonAutocomplete = useCallback(() => {
    searchAutocompleteSeqRef.current += 1;
    setSuggestLoading(false);
    setSuggestions([]);
  }, []);

  /** × on the search bar — collapse to compact destination and clear stuck suggestion lists. */
  const handleSearchDismiss = useCallback(() => {
    handleSearchCancelSuggestions();
    setAllowAutocomplete(false);
    if (planRoutesLength > 0) {
      setSearchExpanded(false);
    }
    const el = document.activeElement;
    if (el instanceof HTMLElement) el.blur();
  }, [handleSearchCancelSuggestions, planRoutesLength]);

  const handleCompactDestOpen = useCallback(() => {
    if (searchBlurClearTimerRef.current) {
      window.clearTimeout(searchBlurClearTimerRef.current);
      searchBlurClearTimerRef.current = null;
    }
    setSearchPickHits(null);
    searchPickQueryRef.current = null;
    setSearchExpanded(true);
    setSearchEditing(true);
    setSearchText("");
    if (isNarrowPhoneViewport()) {
      setSuggestions(rankSearchSuggestionsWithTrail(loadRecentSearchSuggestions()));
    } else {
      setSuggestions([]);
    }
    setSuggestLoading(false);
    setAllowAutocomplete(true);
  }, [rankSearchSuggestionsWithTrail]);

  useEffect(
    () => () => {
      if (searchBlurClearTimerRef.current) {
        window.clearTimeout(searchBlurClearTimerRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (!searchExpanded && planRoutesLength > 0) {
      setSearchEditing(false);
      setSuggestions([]);
      setSuggestLoading(false);
      return;
    }
    const q = searchText.trim();
    if (!allowAutocomplete) {
      setSuggestions([]);
      setSuggestLoading(false);
      return;
    }

    const seq = ++searchAutocompleteSeqRef.current;
    const narrow = isNarrowPhoneViewport();
    const limit = narrow ? 5 : 8;

    if (q.length < 2) {
      if (narrow && searchEditing) {
        setSuggestions(rankSearchSuggestionsWithTrail(loadRecentSearchSuggestions()));
        setSuggestLoading(false);
        return;
      }
      setSuggestions([]);
      setSuggestLoading(false);
      return;
    }

    if (!mapboxToken) {
      setSuggestions([]);
      setSuggestLoading(false);
      return;
    }

    const t = window.setTimeout(() => {
      if (seq !== searchAutocompleteSeqRef.current) return;
      setSuggestions([]);
      setSuggestLoading(true);
      const prox = userLngLatRef.current ?? undefined;
      const countries = geocodeCountriesForFix(userLngLatRef.current) ?? undefined;
      /* Search Box has much deeper local-business coverage than Geocoding v5. We try it first
       * and only fall back to the geocoder when Search Box returns nothing (rare network glitch
       * or off-the-grid query). The session token batches every keystroke + the final /retrieve
       * into one Mapbox-billed transaction. */
      const sessionToken = ensureSearchBoxSessionToken();
      void mapboxSearchBoxSuggest(q, mapboxToken, sessionToken, {
        proximity: prox,
        countries,
        limit,
      })
        .then(async (sbHits) => {
          if (seq !== searchAutocompleteSeqRef.current) return null;
          if (sbHits.length > 0) {
            /* North America defaults to miles for distance display, everywhere else metric. */
            const useMiles =
              !!prox && (geocodeCountriesForFix(prox) ?? []).some((c) => c === "us" || c === "ca");
            const out: SearchSuggestion[] = sbHits.map((s) => {
              /* Compose the secondary line as "1.2 mi · 1234 Main St, Decatur, IL 62526" so
               * users see the full address (number–zip) and can verify closest-first ordering.
               * Distance shows even when the formatted address is missing (rare). */
              const distLabel = formatDistanceShort(s.distanceMeters, useMiles);
              const secondary =
                distLabel && s.placeFormatted
                  ? `${distLabel} · ${s.placeFormatted}`
                  : distLabel || s.placeFormatted;
              return {
                id: s.mapboxId,
                /* Real lng/lat is fetched on pick via /retrieve. We stash a placeholder here so
                 * the row renders; handlePickSuggestion checks `mapboxId` to decide which path. */
                lngLat: prox ?? [0, 0],
                placeName: s.name,
                secondary,
                mapboxId: s.mapboxId,
                featureType: s.featureType,
              };
            });
            return out;
          }
          /* Fallback to Geocoding v5 — keeps the user unblocked if Search Box hiccups. */
          const fb = await mapboxAutocomplete(q, mapboxToken, limit, prox, countries);
          if (seq !== searchAutocompleteSeqRef.current) return null;
          return fb;
        })
        .then((hits) => {
          if (hits == null) return;
          if (seq !== searchAutocompleteSeqRef.current) return;
          setSuggestions(rankSearchSuggestionsWithTrail(hits.slice(0, limit)));
          setSuggestLoading(false);
        })
        .catch(() => {
          if (seq !== searchAutocompleteSeqRef.current) return;
          setSuggestions([]);
          setSuggestLoading(false);
        });
    }, 280);
    return () => window.clearTimeout(t);
    /* userLngLat omitted: GPS updates ~400ms would cancel this debounce and flash the list every tick. */
  }, [
    searchText,
    mapboxToken,
    allowAutocomplete,
    searchExpanded,
    planRoutesLength,
    searchEditing,
    rankSearchSuggestionsWithTrail,
    activityTrailTick,
  ]);

  return {
    searchText,
    setSearchText,
    allowAutocomplete,
    setAllowAutocomplete,
    suggestions,
    setSuggestions,
    suggestLoading,
    setSuggestLoading,
    searchPickHits,
    setSearchPickHits,
    searchPickQueryRef,
    addingViaStop,
    setAddingViaStop,
    destLngLat,
    handleRemoveViaStop,
    handleMapClick,
    handleSavedPlaceNavigate,
    handleSavedMarkerClick,
    handlePickSuggestion,
    handleSearchPickFromMap,
    handleSearch,
    searchPickMarkersForMap,
    handleSearchFieldBeginEditing,
    handleSearchFieldEndEditing,
    handleSearchCancelSuggestions,
    handleSearchDismiss,
    handleCompactDestOpen,
    abandonAutocomplete,
  };
}
