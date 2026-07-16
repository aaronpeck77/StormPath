import { NameConfirmSheet } from "./NameConfirmSheet";
import type { PendingSave } from "../state/uiStore";
import type { FrequentRouteCluster } from "../frequentRoutes/types";
import type { LngLat, RouteTurnStep } from "../nav/types";

type Props = {
  pendingSave: PendingSave;
  recordedSuggestName: string;
  recordedStartLabel: string;
  recordedEndLabel: string;
  addSavedTripRoute: (
    name: string,
    destinationLngLat: LngLat,
    destinationLabel: string,
    geometry: LngLat[],
    turnSteps?: RouteTurnStep[],
    startLabel?: string
  ) => void;
  dismissCluster: (id: string) => void;
  setPendingSave: (next: PendingSave) => void;
  setTapHint: (hint: string | null) => void;
};

/** NameConfirm sheets for save-route / recorded / learned frequent flows. */
export function PendingSaveSheets({
  pendingSave,
  recordedSuggestName,
  recordedStartLabel,
  recordedEndLabel,
  addSavedTripRoute,
  dismissCluster,
  setPendingSave,
  setTapHint,
}: Props) {
  if (!pendingSave) return null;

  if (pendingSave.kind === "route") {
    return (
      <NameConfirmSheet
        title="Save route"
        initialName={`${pendingSave.destinationLabel} · route`}
        hint="Restores this line on the map without calling the router again."
        confirmLabel="Save route"
        onConfirm={(name) => {
          addSavedTripRoute(
            name,
            pendingSave.destinationLngLat,
            pendingSave.destinationLabel,
            pendingSave.geometry,
            pendingSave.turnSteps
          );
          setPendingSave(null);
          setTapHint("Route saved — ★ → Routes → Use.");
          window.setTimeout(() => setTapHint(null), 4000);
        }}
        onCancel={() => setPendingSave(null)}
      />
    );
  }

  if (pendingSave.kind === "recorded") {
    return (
      <NameConfirmSheet
        title="Save recorded path"
        initialName={recordedSuggestName}
        hint="GPS trace — turn prompts are built from your path shape (no router fetch). Run forward or reversed from ★ → Routes."
        confirmLabel="Save route"
        onConfirm={(name) => {
          addSavedTripRoute(
            name,
            pendingSave.destinationLngLat,
            recordedEndLabel.trim() || "Recorded destination",
            pendingSave.geometry,
            undefined,
            recordedStartLabel.trim() || undefined
          );
          setPendingSave(null);
          setTapHint("Recorded route saved — ★ → Routes → Use.");
          window.setTimeout(() => setTapHint(null), 4000);
        }}
        onCancel={() => setPendingSave(null)}
      />
    );
  }

  const c: FrequentRouteCluster = pendingSave.cluster;
  return (
    <NameConfirmSheet
      title="Save frequent route"
      initialName={
        c.startLabel?.trim() && c.endLabel?.trim()
          ? `${c.startLabel.trim()} → ${c.endLabel.trim()}`
          : `Commute · ${c.count}×`
      }
      hint={
        c.startLabel || c.endLabel
          ? `${c.startLabel?.trim() || "Start"} → ${c.endLabel?.trim() || "End"} — same polyline as other saved routes (no new router fetch).`
          : "From Plus trip learning — same polyline behavior as other saved routes (no new router fetch)."
      }
      confirmLabel="Save route"
      onConfirm={(name) => {
        const end = c.geometry[c.geometry.length - 1]!;
        addSavedTripRoute(
          name,
          end,
          c.endLabel?.trim() || "Learned destination",
          c.geometry,
          undefined,
          c.startLabel?.trim() || undefined
        );
        dismissCluster(c.id);
        setPendingSave(null);
        setTapHint("Frequent route saved — ★ → Routes → Use.");
        window.setTimeout(() => setTapHint(null), 4000);
      }}
      onCancel={() => setPendingSave(null)}
    />
  );
}
