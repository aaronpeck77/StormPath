import { useEffect, useState } from "react";
import {
  driveHazardFeedActive,
  selectDriveHazardQueue,
  type DriveHazardQueueInput,
} from "../nav/driveHazardTicker";
import { TABLET_LANDSCAPE_MQ } from "./LandscapeNavigationDock";

type Props = DriveHazardQueueInput & {
  bendHazardId?: string | null;
  onBend?: () => void;
  onDismissBend?: () => void;
  /** Tap a row → fly to the hazard and open its detail (same as phone ticker). */
  onPressHazard?: (id: string) => void;
};

/**
 * iPad landscape command-panel card: countdown (time + distance) to the next
 * two route hazards, all tracks and all nav views. Vertical stack — entries
 * move up/down as the drive progresses. Always renders its card chrome during
 * navigation so the panel slot stays predictable; the body says "all clear"
 * or "feed paused" honestly when the queue is empty. Only mounts on
 * large-tablet landscape — phones never see it (their hazard surface is the
 * drive ticker).
 */
export function LandscapeHazardPanel(props: Props) {
  const { bendHazardId, onBend, onDismissBend, onPressHazard, ...input } = props;
  const [tabletLandscape, setTabletLandscape] = useState(
    () => typeof window !== "undefined" && window.matchMedia(TABLET_LANDSCAPE_MQ).matches
  );

  useEffect(() => {
    const mq = window.matchMedia(TABLET_LANDSCAPE_MQ);
    const update = () => setTabletLandscape(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  if (!tabletLandscape) return null;

  const rows = selectDriveHazardQueue(input, Date.now(), { anyNavView: true });
  const feedActive = driveHazardFeedActive(input);
  return (
    <section className="landscape-hazard-panel" aria-label="Hazards ahead on route">
      <header className="landscape-hazard-panel__title">Hazards ahead</header>
      {rows.length === 0 ? (
        <p className="landscape-hazard-panel__empty">
          {feedActive ? "All clear on this route" : "Hazard feed catching up"}
        </p>
      ) : (
        <ul className="landscape-hazard-panel__list">
          {rows.map((row, index) => {
            const inner = (
              <>
                <span
                  className="landscape-hazard-panel__dot"
                  style={{ backgroundColor: row.color }}
                  aria-hidden="true"
                />
                <span className="landscape-hazard-panel__label" title={row.label}>
                  {row.label}
                </span>
                <span className="landscape-hazard-panel__meta">
                  {row.distanceLabel}
                  {row.etaLabel ? ` · ${row.etaLabel}` : ""}
                </span>
              </>
            );
            const rowClass = `landscape-hazard-panel__row${index === 0 ? " landscape-hazard-panel__row--next" : ""}${onPressHazard ? " landscape-hazard-panel__row--tap" : ""}`;
            return (
              <li key={row.id} className={rowClass}>
                {onPressHazard ? (
                  <button
                    type="button"
                    className="landscape-hazard-panel__hit"
                    onClick={() => onPressHazard(row.id)}
                    aria-label={`${row.label}, ${row.distanceLabel}`}
                  >
                    {inner}
                  </button>
                ) : (
                  inner
                )}
                {bendHazardId === row.id && onBend ? (
                  <span className="landscape-hazard-panel__actions">
                    <button
                      type="button"
                      onClick={onBend}
                      title="Review a route bend when stopped or with a passenger; avoidance is not guaranteed"
                    >
                      Bend route
                    </button>
                    <button type="button" onClick={onDismissBend} aria-label="Dismiss Bend suggestion">
                      Not now
                    </button>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
