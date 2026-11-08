import {
  selectDriveHazardQueue,
  type DriveHazardQueueInput,
} from "../nav/driveHazardTicker";

type Props = DriveHazardQueueInput & {
  bendHazardId?: string | null;
  onBend?: () => void;
  onDismissBend?: () => void;
};

/**
 * iPad landscape command-panel card: countdown (time + distance) to the next
 * two route hazards, all tracks. Vertical stack — entries move up/down as the
 * drive progresses. Rendered inside `.nav-bottom-stack`; CSS in 21-tablet.css
 * keeps it hidden outside large-tablet landscape.
 */
export function LandscapeHazardPanel(props: Props) {
  const { bendHazardId, onBend, onDismissBend, ...input } = props;
  const rows = selectDriveHazardQueue(input);
  if (rows.length === 0) return null;
  return (
    <section className="landscape-hazard-panel" aria-label="Hazards ahead on route">
      <header className="landscape-hazard-panel__title">Hazards ahead</header>
      <ul className="landscape-hazard-panel__list">
        {rows.map((row, index) => (
          <li
            key={row.id}
            className={`landscape-hazard-panel__row${index === 0 ? " landscape-hazard-panel__row--next" : ""}`}
          >
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
        ))}
      </ul>
    </section>
  );
}
