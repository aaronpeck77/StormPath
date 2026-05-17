import { useEffect, useMemo } from "react";
import type { MinutePrecipForecast, RouteForecast } from "../services/tomorrowIo";
import { isTomorrowIoRateLimited } from "../services/tomorrowIo";
import {
  alongRouteSegments,
  arrivalSnapshot,
  compareRouteLegs,
  computeLeaveWindowHint,
} from "../forecast/corridorForecastModel";
import { MinutePrecipStrip } from "./MinutePrecipStrip";
import { formatEtaDuration } from "./formatEta";
import { routePickSlotHex } from "./mapRouteStyle";

export type CorridorForecastLegOption = {
  routeId: string;
  letter: string;
  routeLabel: string;
  etaMinutes: number;
  color: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  destinationLabel: string;
  originLabel?: string;
  hasTrip: boolean;
  navigationStarted: boolean;
  nowcastLine: string | null;
  minutePrecip: MinutePrecipForecast | null;
  forecastsByLegId: Record<string, RouteForecast | null>;
  forecastsLoading: boolean;
  legs: CorridorForecastLegOption[];
  activeLegId: string;
  onActiveLegChange: (routeId: string) => void;
  driveEtaMinutes: number | null;
  forecastDataAvailable: boolean;
};

function sevClass(sev: string): string {
  if (sev === "avoid") return "cfs-sev--avoid";
  if (sev === "serious") return "cfs-sev--serious";
  if (sev === "caution") return "cfs-sev--caution";
  return "cfs-sev--info";
}

export function RouteForecastSheet({
  open,
  onClose,
  destinationLabel,
  originLabel = "Your location",
  hasTrip,
  navigationStarted,
  nowcastLine,
  minutePrecip,
  forecastsByLegId,
  forecastsLoading,
  legs,
  activeLegId,
  onActiveLegChange,
  driveEtaMinutes,
  forecastDataAvailable,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const activeLeg = legs.find((l) => l.routeId === activeLegId) ?? legs[0];
  const activeForecast = activeLeg ? forecastsByLegId[activeLeg.routeId] ?? null : null;
  const tripEta = Math.max(1, Math.round(driveEtaMinutes ?? activeLeg?.etaMinutes ?? 30));

  const along = useMemo(
    () => alongRouteSegments(activeForecast, tripEta),
    [activeForecast, tripEta]
  );
  const arrival = useMemo(
    () => arrivalSnapshot(activeForecast, activeLeg?.etaMinutes ?? tripEta, driveEtaMinutes),
    [activeForecast, activeLeg?.etaMinutes, tripEta, driveEtaMinutes]
  );
  const leaveWindow = useMemo(
    () => computeLeaveWindowHint(minutePrecip, activeForecast, tripEta),
    [minutePrecip, activeForecast, tripEta]
  );
  const legCompare = useMemo(
    () =>
      compareRouteLegs(
        legs.map((l) => ({
          routeId: l.routeId,
          letter: l.letter,
          routeLabel: l.routeLabel,
          etaMinutes: l.etaMinutes,
          forecast: forecastsByLegId[l.routeId] ?? null,
        }))
      ),
    [legs, forecastsByLegId]
  );

  if (!open) return null;

  return (
    <div className="cfs-scrim" role="presentation" onClick={onClose}>
      <div
        className="cfs-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cfs-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="cfs-sheet__header">
          <div>
            <h2 id="cfs-title" className="cfs-sheet__title">
              Corridor forecast
            </h2>
            <p className="cfs-sheet__subtitle">
              Weather along <strong>{originLabel}</strong> → <strong>{destinationLabel || "destination"}</strong>
              {navigationStarted ? " · navigating" : hasTrip ? " · planned route" : ""}
            </p>
          </div>
          <button type="button" className="cfs-sheet__close" onClick={onClose} aria-label="Close corridor forecast">
            Done
          </button>
        </header>

        <div className="cfs-sheet__body">
          {!hasTrip ? (
            <p className="cfs-empty">
              Set a destination to see weather along your drive. You can still view the next hour at your position
              below.
            </p>
          ) : null}

          {nowcastLine ? (
            <section className="cfs-panel" aria-label="Right now">
              <h3 className="cfs-panel__h">Right now</h3>
              <p className="cfs-nowcast">{nowcastLine}</p>
            </section>
          ) : null}

          {minutePrecip ? (
            <section className="cfs-panel cfs-panel--flush" aria-label="At your current location">
              <MinutePrecipStrip forecast={minutePrecip} />
            </section>
          ) : null}

          {leaveWindow ? (
            <section className={`cfs-panel cfs-leave cfs-leave--${leaveWindow.kind}`} aria-label="Leave timing">
              <h3 className="cfs-panel__h">When to leave</h3>
              <p className="cfs-leave__headline">{leaveWindow.headline}</p>
              <p className="cfs-leave__detail">{leaveWindow.detail}</p>
            </section>
          ) : null}

          {legs.length > 1 ? (
            <section className="cfs-panel" aria-label="Route leg">
              <h3 className="cfs-panel__h">Route leg</h3>
              <div className="cfs-leg-tabs" role="tablist">
                {legs.map((leg) => (
                  <button
                    key={leg.routeId}
                    type="button"
                    role="tab"
                    aria-selected={leg.routeId === activeLegId}
                    className={`cfs-leg-tab${leg.routeId === activeLegId ? " cfs-leg-tab--active" : ""}`}
                    style={
                      leg.routeId === activeLegId
                        ? { borderColor: leg.color, color: leg.color }
                        : undefined
                    }
                    onClick={() => onActiveLegChange(leg.routeId)}
                  >
                    <span className="cfs-leg-tab__letter">{leg.letter}</span>
                    <span className="cfs-leg-tab__meta">{formatEtaDuration(leg.etaMinutes)}</span>
                  </button>
                ))}
              </div>
              {activeLeg ? (
                <p className="cfs-leg-caption">{activeLeg.routeLabel}</p>
              ) : null}
            </section>
          ) : null}

          {legCompare && !forecastsLoading ? (
            <section className="cfs-panel" aria-label="Compare routes">
              <h3 className="cfs-panel__h">Compare A / B / C</h3>
              <p className="cfs-compare-narrative">{legCompare.narrative}</p>
              <ul className="cfs-compare-list">
                {legCompare.rows.map((row) => (
                  <li
                    key={row.routeId}
                    className={`cfs-compare-row${row.routeId === legCompare.bestRouteId ? " cfs-compare-row--best" : ""}${row.routeId === activeLegId ? " cfs-compare-row--active" : ""}`}
                  >
                    <button
                      type="button"
                      className="cfs-compare-row__btn"
                      onClick={() => onActiveLegChange(row.routeId)}
                    >
                      <span className="cfs-compare-row__letter">{row.letter}</span>
                      <span className="cfs-compare-row__main">
                        <span className="cfs-compare-row__label">{row.routeLabel}</span>
                        <span className="cfs-compare-row__summary">{row.summary}</span>
                      </span>
                      <span className="cfs-compare-row__eta">{formatEtaDuration(row.etaMinutes)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : forecastsLoading && legs.length > 1 ? (
            <p className="cfs-muted">Loading forecasts for each route leg…</p>
          ) : null}

          <section className="cfs-panel" aria-label="Along your route">
            <h3 className="cfs-panel__h">Along your route</h3>
            {!forecastDataAvailable ? (
              <p className="cfs-muted">
                Corridor forecast is not available in this build (Tomorrow.io key was not included when
                the app was compiled). Install a newer TestFlight build after the key is added to CI, or
                check About → Support diagnostics for <strong>tomorrowIo=off</strong>.
              </p>
            ) : isTomorrowIoRateLimited() ? (
              <p className="cfs-muted">
                Tomorrow.io is paused for about an hour (hourly request limit). NWS and radar on the map
                still work. Try again later or reload after the cooldown.
              </p>
            ) : forecastsLoading && !along.length ? (
              <p className="cfs-muted">Loading corridor forecast…</p>
            ) : along.length === 0 ? (
              <p className="cfs-muted">No hourly samples yet — try again after the route finishes loading.</p>
            ) : (
              <ol className="cfs-along-list">
                {along.map((seg, i) => (
                  <li key={i} className={`cfs-along-item ${sevClass(seg.severity)}`}>
                    <span className="cfs-along-item__eta">~{seg.etaMinutes} min</span>
                    <span className="cfs-along-item__label">{seg.label}</span>
                    <span className="cfs-along-item__detail">{seg.detail}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {arrival ? (
            <section className={`cfs-panel cfs-arrival ${sevClass(arrival.severity)}`} aria-label="At arrival">
              <h3 className="cfs-panel__h">At arrival</h3>
              <p className="cfs-arrival__eta">About {formatEtaDuration(arrival.etaMinutes)} from now</p>
              <p className="cfs-arrival__headline">{arrival.headline}</p>
              <p className="cfs-arrival__detail">{arrival.detail}</p>
            </section>
          ) : null}

          <p className="cfs-footnote">
            Corridor and minute forecasts: <strong>Tomorrow.io</strong>. Tied to your trip and ETA — not a generic city
            page. Map <strong>Rad</strong> (RainViewer) and NWS polygons stay the live map view; this sheet is the
            timeline read.
          </p>
        </div>
      </div>
    </div>
  );
}

/** Build leg tab metadata from plan routes + slot order. */
export function corridorLegOptionsFromPlan(
  routes: { id: string; label: string; baseEtaMinutes: number }[],
  orderedRouteIds: string[]
): CorridorForecastLegOption[] {
  return orderedRouteIds
    .map((routeId, slot) => {
      const route = routes.find((r) => r.id === routeId);
      if (!route) return null;
      const letter = String.fromCharCode(65 + Math.min(slot, 25));
      return {
        routeId: route.id,
        letter,
        routeLabel: route.label.trim() || `Route ${letter}`,
        etaMinutes: Math.max(1, Math.round(route.baseEtaMinutes)),
        color: routePickSlotHex(slot),
      };
    })
    .filter((x): x is CorridorForecastLegOption => x != null);
}
