import type { RouteTurnStep } from "./types";

/** Core’s last step on a live window is “arrive” at a fake dest 100 mi ahead. */
export function isArriveGuidanceInstruction(text: string | null | undefined): boolean {
  if (!text || typeof text !== "string") return false;
  return /destination|you('ll)? (have )?arrived|\barriv(?:e|ing|al)\b/i.test(text);
}

export function isArriveGuidanceStep(step: {
  instruction?: string;
  maneuverType?: string;
} | null | undefined): boolean {
  if (!step) return false;
  const t = (step.maneuverType ?? "").toLowerCase();
  if (t.includes("arrive")) return true;
  return isArriveGuidanceInstruction(step.instruction);
}

/** Next real turn, skipping Core’s window-end arrive. */
export function nextNonArriveStepIndex(
  steps: readonly RouteTurnStep[],
  currentStepIndex: number
): number | null {
  if (!steps.length) return null;
  const start = Math.max(-1, currentStepIndex);
  for (let i = start + 1; i < steps.length; i++) {
    if (!isArriveGuidanceStep(steps[i])) return i;
  }
  return null;
}

/** Banner index that never lands on a window-end arrive when another step exists. */
export function driverBannerStepIndex(
  steps: readonly RouteTurnStep[],
  currentStepIndex: number,
  fallbackIndex: number
): number {
  const nextReal = nextNonArriveStepIndex(steps, currentStepIndex);
  if (nextReal != null) return nextReal;
  const cur = Math.max(0, Math.min(currentStepIndex, steps.length - 1));
  if (!isArriveGuidanceStep(steps[cur])) return cur;
  const any = steps.findIndex((s) => !isArriveGuidanceStep(s));
  return any >= 0 ? any : fallbackIndex;
}

export function continueAlongInstruction(roadName: string | null | undefined): string {
  const n = typeof roadName === "string" ? roadName.trim() : "";
  return n ? `Continue on ${n}` : "Continue";
}
