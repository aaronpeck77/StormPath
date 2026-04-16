/**
 * Always-visible status chip for the hazard controls row. Shows a muted "Idle" when
 * nothing is running; when busy, the label slides up into view on each change.
 */
type Props = {
  busyLabel: string | null;
  className?: string;
};

const IDLE_LABEL = "Idle";

export function ActivityStatusPill({ busyLabel, className = "" }: Props) {
  const display = busyLabel ?? IDLE_LABEL;
  const isBusy = busyLabel != null;

  return (
    <div
      className={`app-activity-pill ${className}`.trim()}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      title={busyLabel ?? undefined}
    >
      <span
        className={`app-activity-pill__dot${isBusy ? "" : " app-activity-pill__dot--idle"}`}
        aria-hidden
      />
      <span className="app-activity-pill__label-clip">
        <span
          key={display}
          className={`app-activity-pill__label app-activity-pill__label--enter${isBusy ? "" : " app-activity-pill__label--idle"}`}
        >
          {display}
        </span>
      </span>
    </div>
  );
}
