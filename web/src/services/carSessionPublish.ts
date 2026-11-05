import { Capacitor } from "@capacitor/core";
import { StormpathCarSession } from "@stormpath/car-session";
import type { TimelineItem } from "../nav/routeAheadSync";
import type { RouteOutlookStep } from "../nav/routeForecastTimeline";
import { formatRouteAlertTiming, isAlertExpired } from "../nav/routeAlertTiming";
import type { PointHourlyForecast } from "./tomorrowIo";
import type { CurrentNowcast } from "./openWeatherClient";

export type CarConditionSection = {
  title: string;
  items: { title: string; detail: string; expiresAt?: number }[];
};

export type CarConditionsInput = {
  items: TimelineItem[];
  userAlongMeters: number;
  totalMeters: number;
  driveEtaMinutes: number | null;
  outlook: RouteOutlookStep[];
  localForecast: PointHourlyForecast | null;
  nowcast: CurrentNowcast | null;
  online: boolean;
  isPlus: boolean;
};

export function buildCarConditions(p: CarConditionsInput): CarConditionSection[] {
  const status = p.online ? "Phone snapshot" : "Offline — saved phone snapshot";
  const hazards = p.items
    /* "Nearby — not crossing" entries are context, not route hazards — the
     * car popup must not fire for them. */
    .filter((item) => item.crossesRoute !== false && item.endMeters >= p.userAlongMeters && !isAlertExpired(item.expiresIso))
    .sort((a, b) => a.startMeters - b.startMeters)
    .map((item) => {
      const timing = formatRouteAlertTiming({
        ...item, userAlongMeters: p.userAlongMeters, totalMeters: p.totalMeters,
        planEtaMinutes: p.driveEtaMinutes, driveEtaMinutes: p.driveEtaMinutes,
      });
      return {
        title: `${item.severity.toUpperCase()} · ${item.label}`,
        detail: [status, item.crossesRoute === false ? "Nearby — not crossing route" : null,
          timing.timingLine, item.etaStale ? "Likely over before you reach it" : null,
          item.coarsePreview ? "Distant outlook" : null,
          item.developingLater ? "Developing later" : null, item.detailLine].filter(Boolean).join(" · "),
        ...(item.expiresIso ? { expiresAt: Date.parse(item.expiresIso) / 1000 } : {}),
      };
    });
  const plusRequired = [{ title: "Plus feature", detail: "Route and local forecast details require Plus." }];
  const outlook = p.outlook.filter((step) => step.fraction * p.totalMeters >= p.userAlongMeters)
    .map((step) => ({
      title: `${step.shortLabel}${step.etaLabel ? ` · ${step.etaLabel}` : ""}`,
      detail: [step.conditions, step.tempF == null ? null : `${Math.round(step.tempF)}°F`,
        step.precipPct == null ? null : `Precipitation ${Math.round(step.precipPct)}%`,
        step.windGustMph == null ? null : `Gusts ${Math.round(step.windGustMph)} mph`].filter(Boolean).join(" · "),
    }));
  const now = Date.now();
  const local = (p.localForecast && now - p.localForecast.fetchedAt < 2 * 60 * 60_000
    ? p.localForecast.hours : []).filter((hour) => Date.parse(hour.timeIso) + 60 * 60_000 > now)
    .map((hour) => ({
      title: new Date(hour.timeIso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
      detail: `${hour.conditions} · ${Math.round(hour.tempF)}°F · Precipitation ${Math.round(hour.precipProbability * 100)}% · Wind ${Math.round(hour.windMph)} mph`,
      expiresAt: Date.parse(hour.timeIso) / 1000 + 3600,
    }));
  if (p.nowcast && now - p.nowcast.fetchedAtMs < 30 * 60_000) {
    local.unshift({
      title: "Now",
      detail: `${p.nowcast.conditions} · ${Math.round(p.nowcast.tempF)}°F · Feels like ${Math.round(p.nowcast.feelsLikeF)}°F · Wind ${Math.round(p.nowcast.windMph)} mph`,
      expiresAt: p.nowcast.fetchedAtMs / 1000 + 1800,
    });
  }
  return [
    { title: "Route hazards", items: hazards.length ? hazards : [{ title: "No hazards in this snapshot", detail: `${status} — not proof of a clear road.` }] },
    { title: "Route forecast", items: !p.isPlus ? plusRequired : outlook.length ? outlook : [{ title: "Forecast unavailable", detail: "No route forecast in the phone snapshot." }] },
    { title: "Local forecast", items: !p.isPlus ? plusRequired : local.length ? local : [{ title: "Forecast unavailable", detail: "No recent local forecast in the phone snapshot." }] },
  ];
}

/** True while the car screen is attached (CarPlay scene alive). Web/false on failure. */
export async function carPlayConnected(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const result = await StormpathCarSession.carPlayConnected();
    return result.connected === true;
  } catch {
    return false;
  }
}

/** Push trip/advisory snapshot for a future CarPlay scene (no-op on web). */
export async function publishCarSession(payload: {
  navigating: boolean;
  destinationLabel?: string | null;
  advisoryLine?: string | null;
  maneuverLine?: string | null;
  conditions?: CarConditionSection[];
  radarTileBase?: string;
  puckColor?: string;
  /**
   * Posted limit in mph from Mapbox data only (electronic horizon or Directions
   * maxspeed). Null / omitted when there is no sourced value — the road-class
   * estimate is deliberately never sent to the car screen.
   */
  speedLimitMph?: number | null;
}): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await StormpathCarSession.publish({
      navigating: payload.navigating,
      destinationLabel: payload.navigating ? payload.destinationLabel?.trim() || "" : "",
      advisoryLine: payload.navigating ? payload.advisoryLine?.trim() || "" : "",
      maneuverLine: payload.navigating ? payload.maneuverLine?.trim() || "" : "",
      conditionsJson: JSON.stringify(payload.conditions ?? []),
      radarTileBase: payload.radarTileBase ?? "",
      puckColor: payload.puckColor ?? "blue",
      speedLimitMph: payload.navigating ? Math.round(payload.speedLimitMph ?? 0) : 0,
    });
  } catch {
    /* CarPlay bridge optional until entitlement + scene are live */
  }
}
