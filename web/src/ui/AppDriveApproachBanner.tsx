import type { Dispatch, SetStateAction } from "react";
import type { LngLat } from "../nav/types";
import type { DriveApproachBannerPhase } from "../nav/driveHazardApproachPreview";
import type { RouteImpact } from "../nav/routeImpacts";
import { TRAFFIC_BYPASS_ENABLED } from "../nav/constants";
import { DriveHazardApproachBanner } from "./DriveHazardApproachBanner";

export type DriveApproachBannerPick = { impact: RouteImpact; phase: DriveApproachBannerPhase } | null;

type Props = {
  hazardApproachAlertsActive: boolean;
  driveApproachBannerPick: DriveApproachBannerPick;
  showTrafficBypassCta: boolean;
  bypassBusy: boolean;
  setDemoApproachBannerOn: Dispatch<SetStateAction<boolean>>;
  setDemoCloseHazardOn: Dispatch<SetStateAction<boolean>>;
  setDriveApproachDismissedIds: Dispatch<SetStateAction<Set<string>>>;
  openDemoTrafficBypassCompareMock: () => void;
  handleTrafficBypassFromHere: (opts?: { anchorAlongMeters?: number; anchorLngLat?: LngLat }) => void;
};

/** Drive-mode heads-up strip for an upcoming hazard — bypass CTA + demo-tool dismiss wiring. */
export function AppDriveApproachBanner({
  hazardApproachAlertsActive,
  driveApproachBannerPick,
  showTrafficBypassCta,
  bypassBusy,
  setDemoApproachBannerOn,
  setDemoCloseHazardOn,
  setDriveApproachDismissedIds,
  openDemoTrafficBypassCompareMock,
  handleTrafficBypassFromHere,
}: Props) {
  if (!hazardApproachAlertsActive || !driveApproachBannerPick) return null;

  return (
    <DriveHazardApproachBanner
      phase={driveApproachBannerPick.phase}
      impact={driveApproachBannerPick.impact}
      rerouteEnabled={
        TRAFFIC_BYPASS_ENABLED &&
        (showTrafficBypassCta ||
          driveApproachBannerPick.impact.id === "demo-approach-banner" ||
          driveApproachBannerPick.impact.id === "demo-close-hazard")
      }
      onDismiss={() => {
        const id = driveApproachBannerPick.impact.id;
        if (id === "demo-approach-banner") {
          setDemoApproachBannerOn(false);
          return;
        }
        if (id === "demo-close-hazard") {
          setDemoCloseHazardOn(false);
          return;
        }
        const key = driveApproachBannerPick.phase === "early" ? `e:${id}` : `n:${id}`;
        setDriveApproachDismissedIds((prev) => new Set(prev).add(key));
      }}
      onPlanAround={() => {
        const id = driveApproachBannerPick.impact.id;
        if (id === "demo-approach-banner") {
          setDemoApproachBannerOn(false);
          openDemoTrafficBypassCompareMock();
          return;
        }
        /* Close-hazard demo runs the *real* bypass pipeline against the live route so
         * we can validate the adaptive next-exit window end-to-end (not the mock compare).
         * We pass the demo impact's anchor explicitly because it isn't in routeImpactsForUi. */
        if (id === "demo-close-hazard") {
          const closeAnchor = driveApproachBannerPick.impact.alongMeters;
          const closeLngLat = driveApproachBannerPick.impact.lngLat;
          setDemoCloseHazardOn(false);
          void handleTrafficBypassFromHere({
            anchorAlongMeters: closeAnchor,
            anchorLngLat: closeLngLat,
          });
          return;
        }
        void handleTrafficBypassFromHere();
      }}
      busy={bypassBusy}
    />
  );
}
