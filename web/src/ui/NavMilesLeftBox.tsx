type Props = {
  label: string;
};

/** Distance remaining — dock chip beside the About (i) button while navigating. */
export function NavMilesLeftBox({ label }: Props) {
  return (
    <div
      className="nav-miles-left-box"
      title="Distance remaining to destination"
      aria-label={`${label} remaining to destination`}
    >
      <span className="nav-miles-left-box__k">Left</span>
      <span className="nav-miles-left-box__v">{label}</span>
    </div>
  );
}
