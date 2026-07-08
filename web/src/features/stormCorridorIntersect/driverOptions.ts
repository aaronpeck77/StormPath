import type { StormCorridorEvent, StormDriverSuggestion, StormIntersectKind } from "./types";

function fmtEta(min: number | null): string {
  if (min == null || !Number.isFinite(min)) return "soon";
  if (min < 1) return "now";
  if (min < 60) return `~${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m > 0 ? `~${h} hr ${m} min` : `~${h} hr`;
}

export function driverSuggestionsForKind(kind: StormIntersectKind): StormDriverSuggestion[] {
  switch (kind) {
    case "enter_heavy":
      return ["slow_down", "consider_reroute", "wait"];
    case "enter_light":
      return ["slow_down", "continue"];
    case "exit_heavy":
    case "exit_light":
      return ["continue"];
    default:
      return ["continue"];
  }
}

export function eventLine(kind: StormIntersectKind, etaMinutes: number | null, intensity: number): string {
  const when = fmtEta(etaMinutes);
  if (kind === "enter_heavy") {
    return `Heavy rain likely ${when} ahead — consider slowing or waiting`;
  }
  if (kind === "enter_light") {
    return `Rain possible ${when} along your route`;
  }
  if (kind === "exit_heavy") {
    return `Heavy rain may end ${when} ahead`;
  }
  if (kind === "exit_light") {
    return `Lighter conditions ${when} ahead`;
  }
  void intensity;
  return "Weather along route";
}

export function verdictForEvent(
  kind: StormIntersectKind,
  etaMinutes: number | null,
  userAlongFraction: number,
  eventFraction: number
): StormCorridorEvent["verdict"] {
  if (eventFraction < userAlongFraction - 0.01) return "may_pass";
  if (kind.startsWith("exit")) return "may_pass";
  if (kind === "enter_heavy") {
    if (etaMinutes != null && etaMinutes <= 90) return "affects_you";
    if (etaMinutes != null && etaMinutes > 120) return "heads_up_only";
    return "uncertain";
  }
  if (kind === "enter_light") {
    if (etaMinutes != null && etaMinutes <= 60) return "uncertain";
    return "heads_up_only";
  }
  return "heads_up_only";
}

export function pickAdvisoryLine(events: StormCorridorEvent[]): string | null {
  const ahead = events.filter((e) => e.verdict === "affects_you" || e.verdict === "uncertain");
  const heavy = ahead.find((e) => e.kind === "enter_heavy");
  if (heavy) return heavy.line;
  const light = ahead.find((e) => e.kind === "enter_light");
  if (light) return light.line;
  const heads = events.find((e) => e.verdict === "heads_up_only" && e.kind.startsWith("enter"));
  return heads?.line ?? null;
}
