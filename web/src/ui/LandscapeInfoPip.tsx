import { useEffect, useState } from "react";
import type { NavRoute } from "../nav/types";
import type { TimelineItem } from "./RouteHazardTimeline";
import { RouteHazardTimeline } from "./RouteHazardTimeline";
import { RouteOverviewPip } from "./RouteOverviewPip";
import type { NormalizedWeatherAlert } from "../weatherAlerts/types";

const TABLET_LANDSCAPE_MQ =
  "(orientation: landscape) and (min-width: 800px) and (min-height: 600px)";

type PipTab = "rt" | "advisory" | "wx";

const TABS: { id: PipTab; label: string; title: string }[] = [
  { id: "rt", label: "RT", title: "Route overview map" },
  { id: "advisory", label: "Adv", title: "Advisory summary" },
  { id: "wx", label: "Wx", title: "Weather and hazard timeline" },
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
  /** Advisory pane: route corridor alerts (stormAdvisoryBarProps.overlappingAlerts). */
  advisoryAlerts: NormalizedWeatherAlert[];
  /** Advisory pane: alerts at the current position. */
  locationAlerts?: NormalizedWeatherAlert[];
  onOpenAdvisory: () => void;
  /** Wx pane: route hazard timeline (same data as the progress rail / advisory). */
  timeline: TimelineItem[];
  totalMeters: number;
  userAlongMeters: number;
  planEtaMinutes: number | null;
  driveEtaMinutes: number | null;
};

function advisoryTone(alerts: NormalizedWeatherAlert[]): "high" | "watch" | "clear" {
  const top = alerts[0];
  if (!top) return "clear";
  const u = `${top.urgency ?? ""} ${top.severity ?? ""}`.toLowerCase();
  if (/extreme|severe/.test(u)) return "high";
  return "watch";
}

/**
 * iPad landscape command-panel PiP: switchable card — RT route-overview map,
 * compact advisory summary, or the weather/hazard timeline graph. Only mounts
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

  const topAlert = props.advisoryAlerts[0] ?? props.locationAlerts?.[0] ?? null;
  const tone = advisoryTone([...props.advisoryAlerts, ...(props.locationAlerts ?? [])]);

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

        {tab === "advisory" ? (
          <div className="landscape-info-pip__advisory">
            <div className="landscape-info-pip__advisory-head">
              <span
                className={`landscape-info-pip__dot landscape-info-pip__dot--${tone}`}
                aria-hidden="true"
              />
              <span className="landscape-info-pip__advisory-title">Advisory</span>
            </div>
            {topAlert ? (
              <p className="landscape-info-pip__advisory-text" title={topAlert.headline}>
                {topAlert.event || topAlert.headline}
                {props.advisoryAlerts.length + (props.locationAlerts?.length ?? 0) > 1
                  ? ` · +${props.advisoryAlerts.length + (props.locationAlerts?.length ?? 0) - 1} more`
                  : ""}
              </p>
            ) : (
              <p className="landscape-info-pip__advisory-text landscape-info-pip__advisory-text--clear">
                All clear on this route
              </p>
            )}
            <button type="button" className="landscape-info-pip__open" onClick={props.onOpenAdvisory}>
              Open advisory
            </button>
          </div>
        ) : null}

        {tab === "wx" ? (
          <div className="landscape-info-pip__wx">
            <RouteHazardTimeline
              variant="full"
              items={props.timeline.filter((item) => !item.stripMuted)}
              totalMeters={props.totalMeters}
              userAlongMeters={props.userAlongMeters}
              planEtaMinutes={props.planEtaMinutes}
              driveEtaMinutes={props.driveEtaMinutes}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}
