import { useMemo, type ReactNode } from "react";
import { formatMinutesAsHoursMinutes } from "../nav/driveRouteAhead";
import { TRAFFIC_BYPASS_ENABLED } from "../nav/constants";
import type { NormalizedWeatherAlert } from "../weatherAlerts/types";
import { nwsGlanceSummary } from "../weatherAlerts/nwsDriveSummary";
import {
  RouteHazardTimeline,
  type TimelineItem,
} from "./RouteHazardTimeline";
import type { StormRoadDetailRow } from "./StormAdvisoryBar";

const GENERIC_NWS_CHIP_TIMING = new Set(["On your planned route"]);

function nwsChipDetailText(a: NormalizedWeatherAlert): string | null {
  const summary = nwsGlanceSummary(a).trim();
  const ev = (a.event ?? "").trim();
  if (!summary) return null;
  if (!ev) return summary;
  const summaryL = summary.toLowerCase();
  const evL = ev.toLowerCase();
  if (summaryL === evL || summaryL.startsWith(`${evL}:`) || summaryL.startsWith(evL)) return null;
  return summary;
}

const GENERIC_ROUTE_TRAFFIC_LABELS = new Set(["Traffic", "Details", "Note"]);

function roadDetailRowHasInfo(row: StormRoadDetailRow): boolean {
  if (GENERIC_ROUTE_TRAFFIC_LABELS.has(row.label)) return false;
  if (typeof row.text === "string") return row.text.trim().length > 0;
  return row.text != null;
}

function FeedRow({
  tag,
  tagTone,
  title,
  detail,
  detailNode,
  timing,
  sevClass,
  onClick,
}: {
  tag: string;
  tagTone: "nws" | "road" | "urgent";
  title: string;
  detail?: string | null;
  detailNode?: ReactNode;
  timing?: string | null;
  sevClass: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className={`adv-dash__feed-dot adv-dash__feed-dot--${sevClass}`} aria-hidden />
      <span className={`adv-dash__feed-tag adv-dash__feed-tag--${tagTone}`}>{tag}</span>
      <span className="adv-dash__feed-body">
        <span className="adv-dash__feed-title">{title}</span>
        {detailNode ? <span className="adv-dash__feed-detail">{detailNode}</span> : null}
        {!detailNode && detail ? <span className="adv-dash__feed-detail">{detail}</span> : null}
        {timing && !GENERIC_NWS_CHIP_TIMING.has(timing) ? (
          <span className="adv-dash__feed-timing">{timing}</span>
        ) : null}
      </span>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className={`adv-dash__feed-row adv-dash__feed-row--${sevClass} adv-dash__feed-row--tap`}
        onClick={onClick}
      >
        {body}
      </button>
    );
  }

  return <div className={`adv-dash__feed-row adv-dash__feed-row--${sevClass}`}>{body}</div>;
}

function nwsSevClass(a: NormalizedWeatherAlert): string {
  if (a.severity === "Extreme" || /tornado warning/i.test(a.event ?? "")) return "avoid";
  if (a.severity === "Severe" || /warning/i.test(a.event ?? "")) return "serious";
  if (a.severity === "Moderate") return "caution";
  return "info";
}

function nwsFeedRow(
  a: NormalizedWeatherAlert,
  timingLine: string,
  tag: string,
  tagTone: "nws" | "urgent",
  onClick: ((alert: NormalizedWeatherAlert) => void) | undefined
): ReactNode {
  return (
    <FeedRow
      key={a.id}
      tag={tag}
      tagTone={tagTone}
      title={a.event?.trim() || "Weather alert"}
      detail={nwsChipDetailText(a)}
      timing={timingLine}
      sevClass={nwsSevClass(a)}
      onClick={onClick ? () => onClick(a) : undefined}
    />
  );
}

export type AdvisoryRouteHazardsPanelProps = {
  navigationStarted: boolean;
  hasGuidanceRoute: boolean;
  barExpanded: boolean;
  sessionOn: boolean;
  roadDetailEnabled: boolean;
  urgentTopAlerts: { alert: NormalizedWeatherAlert; timingLine: string }[];
  alongRouteDetailRows: StormRoadDetailRow[];
  hasRouteHazardDetail: boolean;
  advisoryRouteTimeline: TimelineItem[];
  routeTotalMeters: number;
  userAlongMeters: number;
  planEtaMinutes: number | null;
  driveEtaMinutes: number | null;
  showRerouteCta: boolean;
  onTrafficReroute?: () => void;
  trafficRerouteBusy?: boolean;
  nwsStatusMessage: { tone: "muted" | "warn"; text: string } | null;
  developingNwsAlerts: { alert: NormalizedWeatherAlert; timingLine: string }[];
  panelNwsAlertsExtra: { alert: NormalizedWeatherAlert; timingLine: string }[];
  onNwsAlertClick?: (alert: NormalizedWeatherAlert) => void;
};

export function AdvisoryRouteHazardsPanel({
  navigationStarted,
  hasGuidanceRoute,
  barExpanded,
  sessionOn,
  roadDetailEnabled,
  urgentTopAlerts,
  alongRouteDetailRows,
  hasRouteHazardDetail,
  advisoryRouteTimeline,
  routeTotalMeters,
  userAlongMeters,
  planEtaMinutes,
  driveEtaMinutes,
  showRerouteCta,
  onTrafficReroute,
  trafficRerouteBusy = false,
  nwsStatusMessage,
  developingNwsAlerts,
  panelNwsAlertsExtra,
  onNwsAlertClick,
}: AdvisoryRouteHazardsPanelProps) {
  const activeTimeline = useMemo(
    () => advisoryRouteTimeline.filter((item) => !item.stripMuted && item.endMeters > userAlongMeters),
    [advisoryRouteTimeline, userAlongMeters]
  );

  const nwsTimelineCount = activeTimeline.filter((i) => i.track === "nws" || i.track === "wind").length;
  const roadTimelineCount = activeTimeline.filter((i) => i.track === "road").length;

  const routeFeedRows = useMemo(
    () => alongRouteDetailRows.filter(roadDetailRowHasInfo),
    [alongRouteDetailRows]
  );

  const hasRoadRows = navigationStarted && hasGuidanceRoute && routeFeedRows.length > 0;
  const hasTimeline = hasRouteHazardDetail && (!navigationStarted || barExpanded);
  const showClearRoute =
    navigationStarted &&
    hasGuidanceRoute &&
    !hasRouteHazardDetail &&
    alongRouteDetailRows.length === 0;
  const showRerouteStandalone =
    showRerouteCta && onTrafficReroute && !hasRouteHazardDetail && TRAFFIC_BYPASS_ENABLED;

  const feedCount =
    urgentTopAlerts.length +
    developingNwsAlerts.length +
    panelNwsAlertsExtra.length +
    (hasTimeline ? activeTimeline.length : 0) +
    routeFeedRows.length;

  const routeSubtitle = useMemo(() => {
    if (!hasGuidanceRoute) return "Set a route to see hazards ahead";
    if (showClearRoute) {
      const eta =
        driveEtaMinutes != null && driveEtaMinutes > 0
          ? ` · ${formatMinutesAsHoursMinutes(Math.round(driveEtaMinutes))} remaining`
          : "";
      return `Clear ahead on your route${eta}`;
    }
    const parts: string[] = [];
    if (nwsTimelineCount + urgentTopAlerts.length > 0) {
      parts.push(
        `${nwsTimelineCount + urgentTopAlerts.length} weather ${
          nwsTimelineCount + urgentTopAlerts.length === 1 ? "hazard" : "hazards"
        }`
      );
    }
    if (roadTimelineCount + routeFeedRows.length > 0) {
      parts.push(
        `${roadTimelineCount + routeFeedRows.length} road ${
          roadTimelineCount + routeFeedRows.length === 1 ? "issue" : "issues"
        }`
      );
    }
    if (parts.length === 0 && feedCount > 0) return `${feedCount} items along your route`;
    return parts.length ? parts.join(" · ") : "Checking your route";
  }, [
    hasGuidanceRoute,
    showClearRoute,
    driveEtaMinutes,
    nwsTimelineCount,
    urgentTopAlerts.length,
    roadTimelineCount,
    routeFeedRows.length,
    feedCount,
  ]);

  const hasContent =
    hasGuidanceRoute ||
    hasRoadRows ||
    urgentTopAlerts.length > 0 ||
    developingNwsAlerts.length > 0 ||
    panelNwsAlertsExtra.length > 0 ||
    hasTimeline ||
    showClearRoute ||
    nwsStatusMessage ||
    showRerouteStandalone;

  if (!hasContent) return null;

  return (
    <section className="adv-dash adv-dash--route" aria-label="Hazards on your route">
      <header className="adv-dash__zone">
        <div className="adv-dash__zone-main">
          <span className="adv-dash__zone-tag adv-dash__zone-tag--route">Route</span>
          <span className="adv-dash__zone-place">{routeSubtitle}</span>
        </div>
        <div className="adv-dash__zone-toggles" aria-label="Map layers">
          <span className={`adv-dash__toggle${sessionOn ? " adv-dash__toggle--on" : ""}`}>NWS</span>
          <span className={`adv-dash__toggle${roadDetailEnabled ? " adv-dash__toggle--on" : ""}`}>Roads</span>
        </div>
      </header>

      <div className="adv-dash__block adv-dash__block--route">
      {!navigationStarted && hasGuidanceRoute ? (
        <p className="adv-dash__tip">Tap <strong>Go</strong> for live traffic</p>
      ) : null}

      {nwsStatusMessage ? (
        <p
          className={`adv-dash__tip adv-dash__tip--warn`}
          aria-live="polite"
        >
          {nwsStatusMessage.text}
        </p>
      ) : null}

      {showClearRoute ? (
        <p className="adv-dash__clear" role="status">
          Nothing flagged ahead
        </p>
      ) : null}

      <div className="adv-dash__feed">
        {urgentTopAlerts.map(({ alert, timingLine }) =>
          nwsFeedRow(alert, timingLine, "Now", "urgent", onNwsAlertClick)
        )}

        {hasRoadRows
          ? routeFeedRows.map((row) => (
              <FeedRow
                key={row.label}
                tag="Road"
                tagTone="road"
                title={row.label}
                detail={typeof row.text === "string" ? row.text : undefined}
                detailNode={typeof row.text === "string" ? undefined : row.text}
                sevClass="caution"
                onClick={row.onAction}
              />
            ))
          : null}

        {hasTimeline ? (
          <RouteHazardTimeline
            variant="legendOnly"
            items={advisoryRouteTimeline.filter((item) => !item.stripMuted)}
            totalMeters={routeTotalMeters}
            userAlongMeters={userAlongMeters}
            planEtaMinutes={planEtaMinutes}
            driveEtaMinutes={driveEtaMinutes}
            showRerouteCta={showRerouteCta}
            onReroute={onTrafficReroute}
            rerouteBusy={trafficRerouteBusy}
            groupLegendByTrack
            compactFeed
          />
        ) : null}

        {developingNwsAlerts.map(({ alert, timingLine }) =>
          nwsFeedRow(alert, timingLine, "Later", "nws", onNwsAlertClick)
        )}

        {panelNwsAlertsExtra.map(({ alert, timingLine }) =>
          nwsFeedRow(alert, timingLine, "NWS", "nws", onNwsAlertClick)
        )}

        {showRerouteStandalone ? (
          <div className="adv-dash__feed-action">
            <button
              type="button"
              className="storm-advisory-bar__btn storm-advisory-bar__btn--traffic"
              onClick={onTrafficReroute}
              disabled={trafficRerouteBusy}
            >
              {trafficRerouteBusy ? "Finding alternate route" : "Reroute around traffic"}
            </button>
          </div>
        ) : null}
      </div>
      </div>
    </section>
  );
}
