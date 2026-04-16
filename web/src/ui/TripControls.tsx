type Props = {
  paused: boolean;
  onPauseToggle: () => void;
  onStop: () => void;
};

export function TripControls({ paused, onPauseToggle, onStop }: Props) {
  return (
    <div className="trip-controls">
      <button type="button" className="trip-btn secondary" onClick={onPauseToggle}>
        {paused ? "Resume" : "Pause"}
      </button>
      <button type="button" className="trip-btn danger" onClick={onStop}>
        End trip
      </button>
    </div>
  );
}
