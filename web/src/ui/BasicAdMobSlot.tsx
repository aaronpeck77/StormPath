import { Capacitor } from "@capacitor/core";

type Props = {
  /** Reserved strip while the native AdMob banner is loading or could not fill. */
  state: "loading" | "empty";
  testMode: boolean;
};

/** In-app ad slot frame — native AdMob draws above the dock; dev web shows a plain placeholder box only. */
export function BasicAdMobSlot({ state, testMode }: Props) {
  const devPreview = import.meta.env.DEV && !Capacitor.isNativePlatform();

  if (devPreview) {
    return (
      <div
        className="basic-admob-slot basic-admob-slot--dev-preview"
        role="presentation"
        aria-hidden="true"
      />
    );
  }

  const label =
    state === "loading"
      ? testMode
        ? "Loading test ad…"
        : "Loading ad…"
      : testMode
        ? "Test ad slot — no fill yet"
        : "Ad space — no fill yet";

  return (
    <div className="basic-admob-slot" role="region" aria-label="Advertisement">
      <span className="basic-admob-slot__tag">Ad</span>
      <span className="basic-admob-slot__label">{label}</span>
    </div>
  );
}
