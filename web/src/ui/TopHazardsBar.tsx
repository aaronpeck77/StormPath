import { useEffect, useMemo, useRef, useState } from "react";
import type { LngLat } from "../nav/types";
import { pickDriveAheadCandidate } from "../nav/driveAheadPick";
import { buildRouteAlerts } from "../nav/routeAlerts";
import type { RouteCompareFeedRow } from "../nav/routeWeatherCompare";
import type { ScoredRoute } from "../scoring/scoreRoutes";
import type { RouteSituationSlice } from "../situation/types";
import { formatDelayVersusBaseline } from "./formatEta";
import { pointAlongPolyline } from "./geometryAlong";
import { trafficHintForScoredRoute } from "./TopGuidanceRouteInfo";

export type { RouteAlert } from "../nav/routeAlerts";

type Props = {
  geometry: LngLat[] | undefined;
  userLngLat: LngLat | null;
  slice: RouteSituationSlice | undefined;
  trafficForRoute: ScoredRoute | undefined;
  mapboxForTraffic: boolean;
  trafficFetchDone: boolean;
  routeNotices?: string[];
  forecastWindow?: string | null;
  /** Sharp fly-to for contextual points */
  onInspectOnMap: (lng: number, lat: number, zoom?: number) => void;
  /** Fit all route options + hazard (driver overview) */
  onInspectHazardOverview: (lng: number, lat: number) => void;
  onRerouteHint: () => void;
  /** Multi-route storm / winter comparison (from sampled wx along polylines) */
  compareRows?: RouteCompareFeedRow[];
  /** Router / radar capability limits (when auto-routing “breaks down”) */
  systemLimitRows?: RouteCompareFeedRow[];
  /** Drive view: one-line summary + actions instead of scrolling feed */
  compactWhileDriving?: boolean;
  /** Switch to lowest-stress / suggested other leg */
  onTryAlternateRoute?: () => void;
  alternateRouteAvailable?: boolean;
  /** Open route view for full compare + hazard list */
  onOpenRouteView?: () => void;
};

const TRUNC = 80;

function trunc(s: string, n = TRUNC): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

function midAnchor(geometry: LngLat[] | undefined, userLngLat: LngLat | null): LngLat {
  const p = geometry?.length ? pointAlongPolyline(geometry, 0.42) : null;
  if (p) return p;
  if (userLngLat) return userLngLat;
  return [-98.5, 39.8];
}

function trafficOneLine(
  slice: RouteSituationSlice | undefined,
  trafficForRoute: ScoredRoute | undefined,
  mapboxForTraffic: boolean,
  trafficFetchDone: boolean
): string {
  const delay = slice?.trafficDelayMinutes ?? trafficForRoute?.trafficDelayMinutes ?? 0;
  const t = trafficForRoute
    ? trafficHintForScoredRoute(trafficForRoute, mapboxForTraffic, trafficFetchDone)
    : { text: "—", live: false };
  if (!mapboxForTraffic) return "Traffic: add Mapbox token for live congestion.";
  if (!trafficFetchDone) return "Traffic: loading…";
  if (trafficForRoute?.hasLiveTrafficEstimate) {
    const x =
      delay >= 2
        ? `~${formatDelayVersusBaseline(delay)} vs baseline`
        : "no major slowdown on corridor";
    return `Traffic: ${t.text} · ${x}`;
  }
  return "Traffic: live data unavailable (static ETA).";
}

function weatherLines(
  slice: RouteSituationSlice | undefined,
  forecastWindow: string | null | undefined
): { list: string; full: string } {
  const headline = (slice?.forecastHeadline ?? "No wx samples.").replace(/\s+/g, " ").trim();
  const radar = slice?.radarIntensity ?? 0;
  const r = radar >= 1 ? "heavy precip risk" : radar > 0 ? "light precip possible" : "no heavy precip signal";
  const fw = forecastWindow ? forecastWindow.replace(/\s+/g, " ").trim() : "";
  const full = `Weather: ${headline} · ${r}${fw ? ` · ${fw}` : ""}`;
  const tail = fw ? ` · ${trunc(fw, 56)}` : "";
  const list = `Weather: ${trunc(headline, 48)} · ${r}${tail}`;
  return { list, full };
}

export function TopHazardsBar({
  geometry,
  userLngLat,
  slice,
  trafficForRoute,
  mapboxForTraffic,
  trafficFetchDone,
  routeNotices = [],
  forecastWindow,
  onInspectOnMap,
  onInspectHazardOverview,
  onRerouteHint,
  compareRows = [],
  systemLimitRows = [],
  compactWhileDriving = false,
  onTryAlternateRoute,
  alternateRouteAvailable = false,
  onOpenRouteView,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [driveDetailsOpen, setDriveDetailsOpen] = useState(false);
  const [detailBubble, setDetailBubble] = useState<{ tag: string; body: string; k: number } | null>(
    null
  );
  const bubbleKeyRef = useRef(0);

  useEffect(() => {
    if (!detailBubble) return;
    const t = window.setTimeout(() => setDetailBubble(null), 5600);
    return () => window.clearTimeout(t);
  }, [detailBubble]);

  const alerts = useMemo(
    () =>
      buildRouteAlerts(
        geometry,
        userLngLat,
        slice,
        trafficForRoute,
        mapboxForTraffic,
        trafficFetchDone
      ),
    [geometry, userLngLat, slice, trafficForRoute, mapboxForTraffic, trafficFetchDone]
  );

  const feedRows = useMemo(() => {
    type Row = {
      id: string;
      tag: string;
      text: string;
      fullText: string;
      severity: number;
      overview: boolean;
      lng: number;
      lat: number;
      zoom?: number;
    };
    const rows: Row[] = [];
    const anchor = midAnchor(geometry, userLngLat);

    for (const c of compareRows) {
      const full = c.text.replace(/\s+/g, " ").trim();
      rows.push({
        id: c.id,
        tag: c.tag,
        text: trunc(full),
        fullText: full,
        severity: c.severity,
        overview: c.overview,
        lng: c.lng,
        lat: c.lat,
        zoom: c.zoom,
      });
    }

    for (const s of systemLimitRows) {
      const full = s.text.replace(/\s+/g, " ").trim();
      rows.push({
        id: s.id,
        tag: s.tag,
        text: trunc(full, 118),
        fullText: full,
        severity: s.severity,
        overview: s.overview,
        lng: s.lng,
        lat: s.lat,
        zoom: s.zoom,
      });
    }

    for (const a of alerts) {
      const full = a.detail.replace(/\s+/g, " ").trim();
      rows.push({
        id: a.id,
        tag: a.title,
        text: trunc(full),
        fullText: full,
        severity: a.severity,
        overview: true,
        lng: a.lngLat[0]!,
        lat: a.lngLat[1]!,
        zoom: a.zoom,
      });
    }

    const delay = slice?.trafficDelayMinutes ?? trafficForRoute?.trafficDelayMinutes ?? 0;
    const trafficSev = delay >= 2 ? Math.min(85, 45 + delay * 3) : trafficForRoute?.hasLiveTrafficEstimate ? 25 : 10;
    const trafficFull = trafficOneLine(slice, trafficForRoute, mapboxForTraffic, trafficFetchDone);
    rows.push({
      id: "feed-traffic",
      tag: "Traffic",
      text: trunc(trafficFull),
      fullText: trafficFull,
      severity: trafficSev,
      overview: false,
      lng: anchor[0]!,
      lat: anchor[1]!,
      zoom: 11.4,
    });

    const wx = weatherLines(slice, forecastWindow);
    rows.push({
      id: "feed-weather",
      tag: "Wx",
      text: trunc(wx.list),
      fullText: wx.full,
      severity: slice?.radarIntensity && slice.radarIntensity >= 1 ? 55 : 20,
      overview: false,
      lng: anchor[0]!,
      lat: anchor[1]!,
      zoom: 11.2,
    });

    routeNotices.forEach((n, i) => {
      const full = n.replace(/\s+/g, " ").trim();
      rows.push({
        id: `feed-notice-${i}`,
        tag: "Road",
        text: trunc(full),
        fullText: full,
        severity: 72,
        overview: true,
        lng: anchor[0]!,
        lat: anchor[1]!,
        zoom: 12.2,
      });
    });

    rows.sort((x, y) => y.severity - x.severity || x.id.localeCompare(y.id));
    return rows;
  }, [
    alerts,
    geometry,
    userLngLat,
    slice,
    trafficForRoute,
    mapboxForTraffic,
    trafficFetchDone,
    forecastWindow,
    routeNotices,
    compareRows,
    systemLimitRows,
  ]);

  const driveAheadPick = useMemo(
    () =>
      compactWhileDriving
        ? pickDriveAheadCandidate(Boolean(geometry?.length && userLngLat), geometry, userLngLat, alerts, {
            seriousOnly: false,
          })
        : null,
    [compactWhileDriving, geometry, userLngLat, alerts]
  );

  const driveHeadline = useMemo(() => {
    if (!compactWhileDriving) return null;
    if (driveAheadPick) {
      const { alert, aheadMi } = driveAheadPick;
      const miLabel = aheadMi >= 0.95 ? `${aheadMi.toFixed(1)} mi` : `${Math.max(0.1, aheadMi).toFixed(1)} mi`;
      const det = alert.detail.replace(/\s+/g, " ").trim();
      return {
        line: `${alert.title} · ${miLabel} — ${trunc(det, 64)}`,
        fullText: `${alert.title} (${miLabel}) — ${det}`,
        lng: alert.lngLat[0]!,
        lat: alert.lngLat[1]!,
        zoom: alert.zoom,
        overview: true as const,
      };
    }
    const top = feedRows[0];
    if (!top) return null;
    return {
      line: `${top.tag}: ${top.text}`,
      fullText: top.fullText,
      lng: top.lng,
      lat: top.lat,
      zoom: top.zoom,
      overview: top.overview,
    };
  }, [compactWhileDriving, driveAheadPick, feedRows]);

  if (!trafficForRoute && !slice) {
    return (
      <div className="top-hazards-bar top-hazards-bar--compact" role="region" aria-label="Route conditions">
        <p className="top-hazards-bar__empty">No data</p>
      </div>
    );
  }

  if (compactWhileDriving && driveHeadline) {
    return (
      <div className="top-hazards-bar-stack top-hazards-bar-stack--drive">
        <div className="top-hazards-drive" role="region" aria-label="Conditions ahead">
          <div className="top-hazards-drive__row">
            <span className="top-hazards-drive__label">Along route</span>
            <div className="top-hazards-drive__actions-inline">
              {alternateRouteAvailable && onTryAlternateRoute && (
                <button type="button" className="top-hazards-drive__chip top-hazards-drive__chip--alt" onClick={onTryAlternateRoute}>
                  Try alt
                </button>
              )}
              {onOpenRouteView && (
                <button type="button" className="top-hazards-drive__chip" onClick={onOpenRouteView}>
                  Rt view
                </button>
              )}
            </div>
          </div>
          <button
            type="button"
            className="top-hazards-drive__main"
            title="Show on map"
            onClick={() => {
              bubbleKeyRef.current += 1;
              setDetailBubble({
                tag: "Along route",
                body: driveHeadline.fullText,
                k: bubbleKeyRef.current,
              });
              if (driveHeadline.overview) onInspectHazardOverview(driveHeadline.lng, driveHeadline.lat);
              else onInspectOnMap(driveHeadline.lng, driveHeadline.lat, driveHeadline.zoom);
            }}
          >
            <span className="top-hazards-drive__main-text">{driveHeadline.line}</span>
          </button>
          <div className="top-hazards-drive__toolbar">
            <button
              type="button"
              className="top-hazards-drive__tool"
              onClick={() => setDriveDetailsOpen((v) => !v)}
              aria-expanded={driveDetailsOpen}
            >
              {driveDetailsOpen ? "Less" : "More"}
            </button>
            <button
              type="button"
              className="top-hazards-drive__tool"
              onClick={() => onInspectHazardOverview(driveHeadline.lng, driveHeadline.lat)}
            >
              Map
            </button>
            <button type="button" className="top-hazards-drive__tool" onClick={onRerouteHint}>
              Help
            </button>
          </div>
          {driveDetailsOpen && (
            <ul className="top-hazards-drive__drawer" aria-label="Next conditions">
              {feedRows.slice(0, 5).map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    className="top-hazards-drive__drawer-row"
                    onClick={() => {
                      if (r.overview) onInspectHazardOverview(r.lng, r.lat);
                      else onInspectOnMap(r.lng, r.lat, r.zoom);
                    }}
                  >
                    <span className="top-hazards-drive__drawer-tag">{r.tag}</span>
                    <span className="top-hazards-drive__drawer-text">{r.text}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {detailBubble && (
          <div
            className="top-hazards-detail-bubble top-hazards-detail-bubble--drive"
            role="status"
            aria-live="polite"
            key={detailBubble.k}
          >
            <span className="top-hazards-detail-bubble__tag">{detailBubble.tag}</span>
            <p className="top-hazards-detail-bubble__body">{detailBubble.body}</p>
          </div>
        )}
      </div>
    );
  }

  if (compactWhileDriving && !driveHeadline) {
    return (
      <div className="top-hazards-drive top-hazards-drive--empty" role="region" aria-label="Conditions ahead">
        <p className="top-hazards-drive__empty">No condition data</p>
        {onOpenRouteView && (
          <button type="button" className="top-hazards-drive__chip" onClick={onOpenRouteView}>
            Rt view
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="top-hazards-bar-stack">
      <div className="top-hazards-bar top-hazards-bar--compact" role="region" aria-label="Route hazard feed">
        <div className="top-hazards-feed-head">
          <span>Hazards &amp; conditions</span>
          <button type="button" className="top-hazards-feed-hint" onClick={onRerouteHint}>
            Reroute?
          </button>
        </div>
        <ul className="top-hazards-feed" aria-label="Scroll for more conditions">
          {feedRows.map((r) => (
            <li key={r.id} className="top-hazards-feed__li">
              <button
                type="button"
                className={`top-hazards-feed__row${selectedId === r.id ? " top-hazards-feed__row--selected" : ""}`}
                title="Tap for full text + map"
                onClick={() => {
                  setSelectedId(r.id);
                  bubbleKeyRef.current += 1;
                  setDetailBubble({ tag: r.tag, body: r.fullText, k: bubbleKeyRef.current });
                  if (r.overview) onInspectHazardOverview(r.lng, r.lat);
                  else onInspectOnMap(r.lng, r.lat, r.zoom);
                }}
              >
                <span className="top-hazards-feed__tag">{r.tag}</span>
                <span className="top-hazards-feed__text">{r.text}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      {detailBubble && (
        <div
          className="top-hazards-detail-bubble"
          role="status"
          aria-live="polite"
          key={detailBubble.k}
        >
          <span className="top-hazards-detail-bubble__tag">{detailBubble.tag}</span>
          <p className="top-hazards-detail-bubble__body">{detailBubble.body}</p>
        </div>
      )}
    </div>
  );
}
