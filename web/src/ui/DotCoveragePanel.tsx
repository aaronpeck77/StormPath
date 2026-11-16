import { useEffect, useState } from "react";
import {
  coveredUsStates,
  DOT_COVERAGE_CAVEATS,
  DOT_UNAVAILABLE_STATES,
  dotStateDisplayName,
  fetchDotCoverageStates,
  uncoveredUsStates,
  US_STATE_NAMES,
  WINTER_CONDITION_STATES,
} from "../services/dotCoverage";
import { US_MAP_VIEWBOX, US_STATE_CENTROIDS, US_STATE_PATHS } from "./usStateMap";

/**
 * About-sheet "Road data coverage" — which states have a live DOT work-zone
 * feed vs which don't. Driven by the worker's /coverage endpoint so the list
 * updates itself when a new feed/key goes live; falls back to nothing when the
 * worker is unreachable (better silent than wrong).
 *
 * The map is generated path data (scripts/gen-us-state-map.mjs) — no tiles,
 * no map SDK, works offline inside the sheet.
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
  const uncoveredNames = uncoveredUsStates(covered);
  const naNames = uncoveredNames.filter((s) => DOT_UNAVAILABLE_STATES.includes(s));
  const pendingNames = uncoveredNames.filter((s) => !DOT_UNAVAILABLE_STATES.includes(s));
  if (!coveredNames.length) return null;

  return (
    <details className="about-sheet__panel about-sheet__details">
      <summary>Road data coverage</summary>
      <svg
        className="dotcov__map"
        viewBox={US_MAP_VIEWBOX}
        role="img"
        aria-label="Map of US states with live DOT road-event feeds"
      >
        {US_STATE_NAMES.map((name) => {
          const d = US_STATE_PATHS[name];
          if (!d) return null;
          const isLive = covered.has(name);
          const isNA = !isLive && DOT_UNAVAILABLE_STATES.includes(name);
          return (
            <path
              key={name}
              d={d}
              className={
                isLive
                  ? "dotcov__state dotcov__state--live"
                  : isNA
                    ? "dotcov__state dotcov__state--na"
                    : "dotcov__state"
              }
              fillRule="evenodd"
            >
              <title>
                {dotStateDisplayName(name)}
                {isLive ? " — live DOT feed" : isNA ? " — no public feed (N/A)" : " — no feed yet"}
                {WINTER_CONDITION_STATES.includes(name) ? " · winter road conditions" : ""}
              </title>
            </path>
          );
        })}
        {WINTER_CONDITION_STATES.map((name) => {
          const c = US_STATE_CENTROIDS[name];
          if (!c) return null;
          return (
            <text
              key={name}
              x={c[0]}
              y={c[1]}
              className="dotcov__winter"
              textAnchor="middle"
              dominantBaseline="central"
            >
              ❄
            </text>
          );
        })}
        {DOT_UNAVAILABLE_STATES.map((name) => {
          if (covered.has(name)) return null;
          const c = US_STATE_CENTROIDS[name];
          if (!c) return null;
          return (
            <text
              key={name}
              x={c[0]}
              y={c[1]}
              className="dotcov__na"
              textAnchor="middle"
              dominantBaseline="central"
            >
              N/A
            </text>
          );
        })}
      </svg>
      <div className="dotcov__legend">
        <span className="dotcov__legend-item">
          <i className="dotcov__swatch dotcov__swatch--live" /> Live DOT feed
        </span>
        <span className="dotcov__legend-item">
          <i className="dotcov__swatch" /> No feed yet
        </span>
        <span className="dotcov__legend-item">
          <i className="dotcov__swatch dotcov__swatch--na" /> N/A — no public feed
        </span>
        <span className="dotcov__legend-item">❄ Winter road conditions</span>
      </div>
      <p className="about-sheet__p">
        Live DOT work-zone &amp; closure feeds in {coveredNames.length} states + DC.
        {pendingNames.length
          ? ` No feed yet in: ${pendingNames.map(dotStateDisplayName).join(", ")}.`
          : ""}
        {naNames.length
          ? ` N/A (no public feed): ${naNames.map(dotStateDisplayName).join(", ")}.`
          : ""}
        {!pendingNames.length && !naNames.length ? " Every US state has a feed." : ""}
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
