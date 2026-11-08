import { useEffect, useState } from "react";
import type { NavRoute } from "../nav/types";
import type { TimelineItem } from "./RouteHazardTimeline";
import { RouteOverviewPip } from "./RouteOverviewPip";
import { RouteProgressGlancePanel } from "./RouteProgressGlancePanel";
import { AdvisoryRouteHazardsPanel } from "./AdvisoryRouteHazardsPanel";
import { useAdvisoryExpandedModel } from "./advisoryExpandedModel";
import type { StormAdvisoryBarProps } from "./StormAdvisoryBar";
import type { RouteChunkCalloutItem } from "../nav/routeProgressChunkList";
import type { WxSample } from "../nav/routeChunkWeather";
import type { RouteOutlookStep } from "../nav/routeForecastTimeline";
import { TABLET_LANDSCAPE_MQ } from "./LandscapeNavigationDock";

type PipTab = "rt" | "advisory" | "wx";

const TABS: { id: PipTab; label: string; title: string }[] = [
  { id: "rt", label: "RT", title: "Route overview map" },
  { id: "advisory", label: "Adv", title: "Warnings and hazard alerts on your route" },
  { id: "wx", label: "Wx", title: "Full weather graph — NWS, radar, wind, forecast, road" },
];

type Props = {
  accessToken: string;
  userLngLat: [number, number] | null;
  routes: NavRoute[];
  destLngLat: [number, number] | null;
  lineFocusId: string;
  suggestedRouteId: string | null;
  orderedRouteIds: string[];
  navigationStarted: boolean;
  /** Full advisory prop bag — Adv tab runs the same expanded model as the advisory page. */
  advisoryProps: StormAdvisoryBarProps;
  onOpenAdvisory: () => void;
  /** Wx tab: route hazard timeline (same data as the progress rail / route-info graph). */
  timeline: TimelineItem[];
  planEtaMinutes: number | null;
  driveEtaMinutes: number | null;
  /** TimelineItem.id of the countdown "next" hazard — highlighted in the Wx graph. */
  nextHazardId?: string | null;
  /* Wx tab: same inputs RouteProgressGlancePanel gets on the route-info page. */
  glanceRouteWide: RouteChunkCalloutItem[];
  glanceOutlookSteps: RouteOutlookStep[];
  glanceOutlookSamples?: WxSample[];
  glanceRadarSamples?: { t: number; intensity: number }[];
  glanceRadarStatusNote?: string | null;
  glanceWindPoints?: { t: number; mph: number }[];
  glanceGustLinePoints?: { t: number; mph: number }[];
  glanceGustSpikePoints?: { t: number; mph: number }[];
  glanceFallbackSegments: RouteChunkCalloutItem[];
  glanceTotalMeters: number;
  glanceUserAlongMeters: number;
  glanceUserAlongT: number;
  glanceStripTint: string;
};

/**
 * Adv tab — the same "Hazards on your route" feed that sits under the forecast
 * on the expanded advisory page. Runs the shared expanded model lazily (only
 * while this tab is mounted) so the PiP stays cheap on RT/Wx.
 */
function LandscapeAdvisoryFeed({ advisoryProps }: { advisoryProps: StormAdvisoryBarProps }) {
  const model = useAdvisoryExpandedModel(advisoryProps);
  const p = advisoryProps;
  return (
    <div className="landscape-info-pip__feed">
      <AdvisoryRouteHazardsPanel
        navigationStarted={p.navigationStarted}
        hasGuidanceRoute={p.hasGuidanceRoute}
        barExpanded
        sessionOn={p.sessionOn}
        roadDetailEnabled={p.roadDetailEnabled}
        urgentTopAlerts={model.urgentTopAlerts}
        alongRouteDetailRows={p.roadDetailRows}
        hasRouteHazardDetail={model.hasRouteHazardDetail}
        advisoryRouteTimeline={model.advisoryRouteTimeline}
        routeTotalMeters={p.routeTotalMeters ?? 0}
        userAlongMeters={p.userAlongMeters ?? 0}
        planEtaMinutes={p.planEtaMinutes ?? null}
        driveEtaMinutes={p.driveEtaMinutes ?? null}
        showRerouteCta={model.showRerouteCta}
        onTrafficReroute={p.onTrafficReroute}
        trafficRerouteBusy={p.trafficRerouteBusy}
        nwsStatusMessage={model.nwsStatusMessage}
        developingNwsAlerts={model.developingNwsAlerts}
        panelNwsAlertsExtra={model.panelNwsAlertsExtra}
        onNwsAlertClick={p.onNwsAlertClick}
        highlightedHazardId={p.highlightedHazardId}
      />
    </div>
  );
}

/**
 * iPad landscape command-panel PiP: switchable card — RT route-overview map,
 * the advisory hazards feed, or the full route-info weather graph. Only mounts
 * on large-tablet landscape so phones never pay for the second GL context.
 */
export function LandscapeInfoPip(props: Props) {
  const [tabletLandscape, setTabletLandscape] = useState(
    () => typeof window !== "undefined" && window.matchMedia(TABLET_LANDSCAPE_MQ).matches
  );
  const [tab, setTab] = useState<PipTab>("rt");

  useEffect(() => {
    const mq = window.matchMedia(TABLET_LANDSCAPE_MQ);
    const update = () => setTabletLandscape(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  if (!tabletLandscape) return null;

  return (
    <section className="landscape-info-pip" aria-label="Route info picture-in-picture">
      <div className="landscape-info-pip__tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`landscape-info-pip__tab${tab === t.id ? " landscape-info-pip__tab--active" : ""}`}
            title={t.title}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="landscape-info-pip__stage">
        {tab === "rt" ? (
          <RouteOverviewPip
            accessToken={props.accessToken}
            userLngLat={props.userLngLat}
            routes={props.routes}
            destLngLat={props.destLngLat}
            lineFocusId={props.lineFocusId}
            suggestedRouteId={props.suggestedRouteId}
            orderedRouteIds={props.orderedRouteIds}
            navigationStarted={props.navigationStarted}
          />
        ) : null}

        {tab === "advisory" ? <LandscapeAdvisoryFeed advisoryProps={props.advisoryProps} /> : null}

        {tab === "wx" ? (
          <div className="landscape-info-pip__wx">
            <RouteProgressGlancePanel
              timeline={props.timeline}
              routeWide={props.glanceRouteWide}
              outlookSteps={props.glanceOutlookSteps}
              outlookSamples={props.glanceOutlookSamples}
              radarSamples={props.glanceRadarSamples}
              radarStatusNote={props.glanceRadarStatusNote}
              windPoints={props.glanceWindPoints}
              gustLinePoints={props.glanceGustLinePoints}
              gustSpikePoints={props.glanceGustSpikePoints}
              fallbackSegments={props.glanceFallbackSegments}
              totalMeters={props.glanceTotalMeters}
              userAlongMeters={props.glanceUserAlongMeters}
              planEtaMinutes={props.planEtaMinutes}
              driveEtaMinutes={props.driveEtaMinutes}
              userAlongT={props.glanceUserAlongT}
              stripTint={props.glanceStripTint}
              nextHazardId={props.nextHazardId}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}
