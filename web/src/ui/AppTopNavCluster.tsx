import type { Dispatch, SetStateAction } from "react";
import type { LngLat, RouteTurnStep } from "../nav/types";
import type { PersonalForkOffer } from "../personalForks";
import { TopGuidanceBar } from "./TopGuidanceBar";
import { YourRouteChip } from "./YourRouteChip";
import { StormAdvisoryBar, type StormAdvisoryBarProps } from "./StormAdvisoryBar";
import { ActivityStatusPill } from "./ActivityStatusPill";
import { AppDriveApproachBanner, type DriveApproachBannerPick } from "./AppDriveApproachBanner";

type Props = {
  navigationStarted: boolean;
  hasPlanRoutes: boolean;
  turnSteps: RouteTurnStep[];
  bannerTurnIndex: number;
  metersToBannerManeuver: number | null;
  viewMode: string;
  personalForkShowChip: boolean;
  personalForkShowCommittedChip: boolean;
  personalForkOffer: PersonalForkOffer | null;
  onTakePersonalFork: () => void;
  onDismissPersonalFork: () => void;
  showStormAdvisoryChrome: boolean;
  stormAdvisoryBarProps: StormAdvisoryBarProps;
  isPlus: boolean;
  activityBusyLabel: string | null;
  radarMapOverlayOn: boolean;
  radarFrameClockLabel: string | null;
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

/** Top overlay cluster: guidance bar, personal-fork chip, storm/activity bar, radar clock, approach banner. */
export function AppTopNavCluster({
  navigationStarted,
  hasPlanRoutes,
  turnSteps,
  bannerTurnIndex,
  metersToBannerManeuver,
  viewMode,
  personalForkShowChip,
  personalForkShowCommittedChip,
  personalForkOffer,
  onTakePersonalFork,
  onDismissPersonalFork,
  showStormAdvisoryChrome,
  stormAdvisoryBarProps,
  isPlus,
  activityBusyLabel,
  radarMapOverlayOn,
  radarFrameClockLabel,
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
  return (
    <div className="nav-top-cluster">
      <div className="nav-top-route-rail">
        <div className="nav-top-route-rail__main">
          <TopGuidanceBar
            hasRoute={navigationStarted && hasPlanRoutes}
            turnSteps={turnSteps}
            activeTurnIndex={bannerTurnIndex}
            metersToManeuverEnd={metersToBannerManeuver}
            glanceable={navigationStarted && viewMode === "drive"}
          />
          {(personalForkShowChip || personalForkShowCommittedChip) && personalForkOffer ? (
            <YourRouteChip
              offer={personalForkOffer}
              committed={Boolean(personalForkShowCommittedChip)}
              onTake={onTakePersonalFork}
              onDismiss={onDismissPersonalFork}
            />
          ) : null}
          {showStormAdvisoryChrome ? (
            <StormAdvisoryBar {...stormAdvisoryBarProps} />
          ) : isPlus ? (
            <div className="nav-top-activity-pill-wrap nav-top-activity-pill-wrap--solo">
              <ActivityStatusPill busyLabel={activityBusyLabel} />
            </div>
          ) : null}
          {radarMapOverlayOn && radarFrameClockLabel ? (
            <div
              className="map-radar-frame-time-cluster"
              aria-live="polite"
              title="Radar mosaic time (local)"
            >
              {radarFrameClockLabel}
            </div>
          ) : null}
          <AppDriveApproachBanner
            hazardApproachAlertsActive={hazardApproachAlertsActive}
            driveApproachBannerPick={driveApproachBannerPick}
            showTrafficBypassCta={showTrafficBypassCta}
            bypassBusy={bypassBusy}
            setDemoApproachBannerOn={setDemoApproachBannerOn}
            setDemoCloseHazardOn={setDemoCloseHazardOn}
            setDriveApproachDismissedIds={setDriveApproachDismissedIds}
            openDemoTrafficBypassCompareMock={openDemoTrafficBypassCompareMock}
            handleTrafficBypassFromHere={handleTrafficBypassFromHere}
          />
        </div>
      </div>
    </div>
  );
}
