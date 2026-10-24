export type AssistantPlanApply = "skip" | "set-and-wait" | "replan-and-resume";

/** A new assistant plan before Go waits for the driver. During a drive it measures again and continues. */
export function assistantPlanApply(opts: {
  navigationStarted: boolean;
  planId: string | null;
  appliedPlanId: string;
}): AssistantPlanApply {
  if (!opts.planId || opts.planId === opts.appliedPlanId) return "skip";
  return opts.navigationStarted ? "replan-and-resume" : "set-and-wait";
}
