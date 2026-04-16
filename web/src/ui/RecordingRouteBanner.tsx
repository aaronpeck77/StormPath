type Props = {
  pointCount: number;
  lengthMeters: number;
  onStopSave: () => void;
  onDiscard: () => void;
};

export function RecordingRouteBanner({ pointCount, lengthMeters, onStopSave, onDiscard }: Props) {
  const mi = lengthMeters * 0.000621371;
  const miLabel = mi >= 0.1 ? ` · ${mi.toFixed(2)} mi` : "";

  return (
    <div className="route-recording-banner" role="status" aria-live="polite">
      <span className="route-recording-pulse" aria-hidden />
      <span className="route-recording-text">
        Recording path
        <span className="route-recording-meta">
          {" "}
          · {pointCount} pts{miLabel}
        </span>
      </span>
      <div className="route-recording-actions">
        <button type="button" className="route-recording-btn route-recording-btn--primary" onClick={onStopSave}>
          Stop &amp; save
        </button>
        <button type="button" className="route-recording-btn" onClick={onDiscard}>
          Discard
        </button>
      </div>
    </div>
  );
}
