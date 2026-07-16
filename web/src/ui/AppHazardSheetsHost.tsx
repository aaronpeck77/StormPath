import type { RouteHazardSheetState } from "../state/uiStore";
import { RouteHazardSheet } from "./RouteHazardSheet";
import { TollFlowSheets } from "./TollFlowSheets";

type Props = {
  routeHazardSheet: RouteHazardSheetState;
  hazardSheetAlternateAvailable: boolean;
  bypassBusy: boolean;
  onCloseRouteHazardSheet: () => void;
  handleHazardSheetTryAlternate: () => void;
  tollAvoidFailureNote: string | null;
  tollAvoidBusy: boolean;
  routing: boolean;
  handleTollContinue: () => void;
  handleTollPreview: () => void | Promise<void>;
};

/** Hosts the route-hazard sheet + toll-flow sheets — both self-contained overlays. */
export function AppHazardSheetsHost({
  routeHazardSheet,
  hazardSheetAlternateAvailable,
  bypassBusy,
  onCloseRouteHazardSheet,
  handleHazardSheetTryAlternate,
  tollAvoidFailureNote,
  tollAvoidBusy,
  routing,
  handleTollContinue,
  handleTollPreview,
}: Props) {
  return (
    <>
      {routeHazardSheet && (
        <RouteHazardSheet
          open
          alerts={routeHazardSheet.alerts}
          alternateRouteAvailable={hazardSheetAlternateAvailable}
          bypassBusy={bypassBusy}
          onClose={onCloseRouteHazardSheet}
          onTryAlternateRoute={handleHazardSheetTryAlternate}
        />
      )}

      <TollFlowSheets
        avoidFailureNote={tollAvoidFailureNote}
        busy={tollAvoidBusy || routing}
        onContinue={handleTollContinue}
        onPreview={() => void handleTollPreview()}
      />
    </>
  );
}
