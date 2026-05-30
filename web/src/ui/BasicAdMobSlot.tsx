type Props = {
  /** Reserved strip while the native AdMob banner is loading or could not fill. */
  state: "loading" | "empty";
  testMode: boolean;
};

/** Dev web preview only — native TestFlight/App Store uses the AdMob SDK at the screen bottom. */
export function BasicAdMobSlot(_props: Props) {
  return (
    <div
      className="basic-admob-slot basic-admob-slot--dev-preview"
      role="presentation"
      aria-hidden="true"
    />
  );
}
