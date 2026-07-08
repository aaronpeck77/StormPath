export type StormIntersectKind = "enter_light" | "exit_light" | "enter_heavy" | "exit_heavy";

export type StormDriverSuggestion = "continue" | "slow_down" | "wait" | "consider_reroute";

export type StormCorridorEvent = {
  fraction: number;
  alongMeters: number;
  kind: StormIntersectKind;
  /** 0–1 radar display intensity at crossing */
  intensity: number;
  /** Minutes from now until you reach this point */
  etaMinutes: number | null;
  /** affects_you | may_pass | uncertain | heads_up_only */
  verdict: "affects_you" | "may_pass" | "uncertain" | "heads_up_only";
  suggestions: StormDriverSuggestion[];
  line: string;
};

export type StormCorridorBand = { start: number; end: number; level: "light" | "heavy" };

export type StormCorridorIntersectResult = {
  events: StormCorridorEvent[];
  bands: StormCorridorBand[];
  /** Best line for StormAdvisoryBar / route preview */
  advisoryLine: string | null;
};
