import { useEffect, useState } from "react";
import {
  coveredUsStates,
  DOT_COVERAGE_CAVEATS,
  dotStateDisplayName,
  fetchDotCoverageStates,
  uncoveredUsStates,
} from "../services/dotCoverage";

/**
 * About-sheet "Road data coverage" — which states have a live DOT work-zone
 * feed vs which don't. Driven by the worker's /coverage endpoint so the list
 * updates itself when a new feed/key goes live; falls back to nothing when the
 * worker is unreachable (better silent than wrong).
 */
export function DotCoveragePanel() {
  const [covered, setCovered] = useState<Set<string> | null>(null);

  useEffect(() => {
    let alive = true;
    void fetchDotCoverageStates().then((s) => {
      if (alive && s.size > 0) setCovered(s);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!covered) return null;
  const coveredNames = coveredUsStates(covered).map(dotStateDisplayName);
  const uncoveredNames = uncoveredUsStates(covered).map(dotStateDisplayName);
  if (!coveredNames.length) return null;

  return (
    <details className="about-sheet__panel about-sheet__details">
      <summary>Road data coverage</summary>
      <p className="about-sheet__p">
        Live DOT work-zone &amp; closure feeds in {coveredNames.length} states + DC.
        {uncoveredNames.length
          ? ` No feed yet in: ${uncoveredNames.join(", ")}.`
          : " Every US state has a feed."}
      </p>
      {DOT_COVERAGE_CAVEATS.map((c) => (
        <p key={c} className="about-sheet__p about-sheet__p--tight">
          {c}
        </p>
      ))}
      <p className="about-sheet__p about-sheet__p--tight">
        Outside these states, hazard silence means no DOT feed — not a clear road.
      </p>
    </details>
  );
}
