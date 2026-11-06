import type { RefObject } from "react";
import { buildCarConditions, type CarConditionsInput } from "../services/carSessionPublish";
import { formatDistanceShort } from "../utils/formatDistance";
import { formatMinutesAsHoursMinutes } from "./formatEta";
import { SPEED_LIMIT_DISPLAY_ENABLED } from "../nav/postedSpeed";
import type { LngLat, RouteTurnStep } from "../nav/types";
import type { RouteAlert } from "../nav/routeAlerts";
import type { RouteChunkCalloutItem } from "../nav/routeProgressChunkList";
import type { WxSample } from "../nav/routeChunkWeather";
import type { RouteOutlookStep } from "../nav/routeForecastTimeline";
import type { TimelineItem } from "./RouteHazardTimeline";
import type { StormProgressBand } from "./RouteProgressStrip";
import { RouteProgressGlancePanel } from "./RouteProgressGlancePanel";
import { RouteProgressStrip } from "./RouteProgressStrip";

type RadarSample = { t: number; intensity: number };
type WindPoint = { t: number; mph: number };

/** Everything the real progress rail + weather graph need — same data the map view uses. */
export type CarPlayCompanionRail = {
  stripGeometry: LngLat[];
  userLngLat: LngLat | null;
  stripAlerts: RouteAlert[];
  radarIntensity: number;
  stripRouteColor: string;
  stripTurnSteps: RouteTurnStep[] | undefined;
  fallbackTurnSteps: RouteTurnStep[];
  stormBands: StormProgressBand[];
  radarSliceSamples: RadarSample[];
  radarSliceLoopFrames?: RadarSample[][];
  tripOdometerM: number;

  timeline: TimelineItem[];
  routeWide: RouteChunkCalloutItem[];
  outlookSteps: RouteOutlookStep[];
  outlookSamples: WxSample[] | undefined;
  radarMosaicSamples: RadarSample[];
  radarStatusNote: string | null;
  windPoints: WindPoint[];
  gustLinePoints: WindPoint[];
  gustSpikePoints: WindPoint[];
  fallbackSegments: RouteChunkCalloutItem[];
  planEtaMinutes: number | null;
  progressAlongM: number;
  userAlongT: number;
  stripTint: string;
  detailScrollRef?: RefObject<HTMLDivElement | null>;
};

type Props = {
  destinationLabel: string | null;
  /** Live minutes-remaining estimate (same source the car sees). */
  etaMinutes: number | null;
  advisoryLine: string | null;
  /** Sourced posted limit only — null hides the chip. */
  speedLimitMph: number | null;
  conditions: CarConditionsInput;
  rail: CarPlayCompanionRail;
  useMiles: boolean;
  onShowMap: () => void;
};

const SEVERITY_DOT: Record<string, string> = {
  AVOID: "#f87171",
  WARNING: "#f87171",
  CAUTION: "#fbbf24",
  ADVISORY: "#38bdf8",
  INFO: "#38bdf8",
};

function severityDot(title: string): string | null {
  const head = title.split("·")[0]?.trim().toUpperCase() ?? "";
  return SEVERITY_DOT[head] ?? null;
}

/**
 * Phone companion page shown while CarPlay is driving.
 * The car screen owns guidance; this page is the detail view — the real
 * progress rail strip, the route weather graph, and the same conditions
 * snapshot the car summarizes, so the two never disagree.
 */
export function CarPlayCompanionView(p: Props) {
  const sections = buildCarConditions(p.conditions);
  const total = Math.max(0, p.conditions.totalMeters);
  const along = Math.min(Math.max(0, p.conditions.userAlongMeters), total);
  const pct = total > 0 ? along / total : 0;
  const remainingM = Math.max(0, total - along);
  const dist = formatDistanceShort(remainingM, p.useMiles);
  const arrive =
    p.etaMinutes != null && Number.isFinite(p.etaMinutes)
      ? new Date(Date.now() + p.etaMinutes * 60_000)
      : null;
  const r = p.rail;

  return (
    <div className="cp-companion" role="region" aria-label="CarPlay companion">
      <header className="cp-companion__head">
        <span className="cp-companion__badge">CarPlay driving</span>
        <button type="button" className="cp-companion__mapbtn" onClick={p.onShowMap}>
          Map
        </button>
      </header>

      <section className="cp-companion__eta">
        <div className="cp-companion__dest">{p.destinationLabel || "Active trip"}</div>
        <div className="cp-companion__stats">
          <span>
            {p.etaMinutes != null
              ? p.etaMinutes >= 60
                ? formatMinutesAsHoursMinutes(Math.round(p.etaMinutes))
                : `${Math.max(0, Math.round(p.etaMinutes))} min`
              : "—"}
            {dist ? ` · ${dist} left` : ""}
          </span>
          {arrive ? (
            <span className="cp-companion__arrive">
              Arrive ~{arrive.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
            </span>
          ) : null}
        </div>
        {p.advisoryLine ? <p className="cp-companion__advisory">{p.advisoryLine}</p> : null}
        <div className="cp-companion__meta">
          {SPEED_LIMIT_DISPLAY_ENABLED && p.speedLimitMph != null && p.speedLimitMph > 0 ? (
            <span className="cp-companion__chip">{Math.round(p.speedLimitMph)} mph limit</span>
          ) : null}
          <span className="cp-companion__chip cp-companion__chip--dim">
            {Math.round(pct * 100)}% there
          </span>
        </div>
      </section>

      {/* The real progress rail, turned sideways for the page: route line,
       * turn ticks, storm bands, and the radar slice crossing the path. */}
      <div className="cp-companion__rail">
        <RouteProgressStrip
          layout="fullBleed"
          geometry={r.stripGeometry}
          userLngLat={r.userLngLat}
          userAlongMeters={r.progressAlongM}
          alerts={r.stripAlerts}
          radarIntensity={r.radarIntensity}
          routeLineColor={r.stripRouteColor}
          turnSteps={r.stripTurnSteps ?? r.fallbackTurnSteps}
          stormBands={r.stormBands}
          radarSliceSamples={r.radarSliceSamples}
          radarSliceLoopFrames={r.radarSliceLoopFrames}
          driveEndsEmphasis
          tripOdometerM={r.tripOdometerM}
          tripRelativeProgress
        />
      </div>

      {/* Route weather graph — wind, radar, rain, temperature along the route. */}
      <div className="cp-companion__graph">
        <RouteProgressGlancePanel
          timeline={r.timeline}
          routeWide={r.routeWide}
          outlookSteps={r.outlookSteps}
          outlookSamples={r.outlookSamples}
          radarSamples={r.radarMosaicSamples}
          radarStatusNote={r.radarStatusNote}
          windPoints={r.windPoints}
          gustLinePoints={r.gustLinePoints}
          gustSpikePoints={r.gustSpikePoints}
          fallbackSegments={r.fallbackSegments}
          totalMeters={total}
          userAlongMeters={r.progressAlongM}
          planEtaMinutes={r.planEtaMinutes}
          driveEtaMinutes={p.etaMinutes}
          userAlongT={r.userAlongT}
          stripTint={r.stripTint}
          detailScrollRef={r.detailScrollRef}
        />
      </div>

      {sections.map((section) => (
        <section key={section.title} className="cp-companion__card">
          <h2 className="cp-companion__cardtitle">{section.title}</h2>
          <ul className="cp-companion__list">
            {section.items.map((item, i) => {
              const dot = severityDot(item.title);
              return (
                <li key={`${item.title}-${i}`} className="cp-companion__item">
                  <span
                    className="cp-companion__dot"
                    style={dot ? { background: dot } : undefined}
                    aria-hidden
                  />
                  <div className="cp-companion__itembody">
                    <div className="cp-companion__itemtitle">{item.title}</div>
                    <div className="cp-companion__itemdetail">{item.detail}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
