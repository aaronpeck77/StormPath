import { useEffect } from "react";
import type { AutocompleteHit } from "../services/mapboxGeocode";

export type SearchSuggestion = AutocompleteHit;

type Props = {
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
  onSearch: () => void;
  suggestions?: SearchSuggestion[];
  onPickSuggestion?: (hit: SearchSuggestion) => void;
  suggestionsLoading?: boolean;
  /** When false, the suggestion list is never shown (e.g. after map-pick destination). */
  enableSuggestions?: boolean;
  /** When true, allow showing the suggestions list even when input is empty. */
  showSuggestionsWhenEmpty?: boolean;
  /** Focus / tap on the field (e.g. mobile): parent can clear value & suggestions for a fresh query. */
  onBeginEditing?: () => void;
  /** Blur: parent can hide suggestions (prevents “stuck” lists on load). */
  onEndEditing?: () => void;
  /** Escape: full dismiss (use when blur path intentionally keeps the list open). */
  onCancelSuggestions?: () => void;
};

export function SearchBar({
  value,
  placeholder = "Where to?",
  onChange,
  onSearch,
  suggestions = [],
  onPickSuggestion,
  suggestionsLoading,
  enableSuggestions = true,
  showSuggestionsWhenEmpty = false,
  onBeginEditing,
  onEndEditing,
  onCancelSuggestions,
}: Props) {
  const t = value.trim();
  /** Keep list open for 0–1 chars on phone (recents) so the panel does not flash off between keystrokes. */
  const showList = Boolean(
    enableSuggestions &&
      onPickSuggestion &&
      (t.length >= 2 || (showSuggestionsWhenEmpty && t.length <= 1))
  );

  useEffect(() => {
    if (!showList) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (onCancelSuggestions) onCancelSuggestions();
        else onEndEditing?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showList, onEndEditing, onCancelSuggestions]);

  return (
    <div className="nav-search-wrap">
      <form
        className="nav-search-form"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          onSearch();
        }}
      >
        <span className="nav-search-icon" aria-hidden>
          ⌕
        </span>
        <input
          type="search"
          className="nav-search-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => onBeginEditing?.()}
          onBlur={() => {
            // Allow taps on suggestion buttons without the input blur immediately
            // clearing the list (mobile browsers often blur before firing click).
            window.setTimeout(() => onEndEditing?.(), 220);
          }}
          placeholder={placeholder}
          enterKeyHint="search"
          autoComplete="off"
          aria-label="Search destination"
          aria-expanded={showList}
          aria-controls="nav-search-suggestions"
        />
      </form>
      {showList && (
        <ul id="nav-search-suggestions" className="nav-search-suggestions" role="listbox">
          {suggestionsLoading && t.length >= 2 && (
            <li className="nav-search-suggestion muted" role="option">
              Searching…
            </li>
          )}
          {suggestions.map((h) => (
            <li key={h.id} role="none">
              <button
                type="button"
                role="option"
                className="nav-search-suggestion"
                onPointerDown={(e) => {
                  // Keep focus on input so the suggestion list doesn't disappear mid-tap.
                  e.preventDefault();
                }}
                onClick={() => onPickSuggestion?.(h)}
                disabled={suggestionsLoading && t.length >= 2}
              >
                {h.placeName}
              </button>
            </li>
          ))}
          {!suggestionsLoading && suggestions.length === 0 && t.length >= 2 && (
            <li className="nav-search-suggestion muted" role="option">
              No matches
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
