/** Minimal Mapbox Directions step shape for toll detection. */
export type TollDetectLeg = {
  steps?: {
    name?: string;
    ref?: string;
    intersections?: {
      classes?: string[];
      toll_collection?: { name?: string; type?: string };
    }[];
  }[];
};

export type RouteTollInfo = {
  hasTolls: boolean;
  /** Road refs/names or toll booth labels — capped for UI. */
  tollLabels: string[];
};

/** Scan step intersections for Mapbox `toll` class or toll collection points. */
export function detectRouteTollsFromLegs(legs: TollDetectLeg[] | undefined): RouteTollInfo {
  const labels = new Set<string>();
  let hasTolls = false;

  for (const leg of legs ?? []) {
    for (const step of leg.steps ?? []) {
      const stepLabel =
        (typeof step.ref === "string" && step.ref.trim()) ||
        (typeof step.name === "string" && step.name.trim()) ||
        "";

      for (const ix of step.intersections ?? []) {
        if (ix.classes?.includes("toll")) {
          hasTolls = true;
          if (stepLabel) labels.add(stepLabel);
        }
        const tc = ix.toll_collection;
        if (tc?.name?.trim()) {
          hasTolls = true;
          labels.add(tc.name.trim());
        } else if (tc?.type === "toll_booth" || tc?.type === "toll_gantry") {
          hasTolls = true;
          if (stepLabel) labels.add(stepLabel);
        }
      }
    }
  }

  return { hasTolls, tollLabels: [...labels].slice(0, 8) };
}
