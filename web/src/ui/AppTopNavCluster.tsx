import type { Dispatch, ReactNode, SetStateAction } from "react";
import type { LngLat, RouteTurnStep } from "../nav/types";
import type { PersonalForkOffer } from "../personalForks";
import { TopGuidanceBar } from "./TopGuidanceBar";
import { YourRouteChip } from "./YourRouteChip";
import { StormAdvisoryBar, type StormAdvisoryBarProps } from "./StormAdvisoryBar";
import { ActivityStatusPill } from "./ActivityStatusPill";
import { LandscapeDockContent } from "./LandscapeNavigationDock";
import { AppDriveApproachBanner, type DriveApproachBannerPick } from "./AppDriveApproachBanner";

type Props = {
  navigationStarted: boolean;
  hasPlanRoutes: boolean;
  turnSteps: RouteTurnStep[];
  bannerTurnIndex: number;
  metersToBannerManeuver: number | null;
  /** iOS native Core turn text when DIY steps are out of sync. */
  bannerInstructionOverride?: string | null;
  bannerCurrentRoadName?: string | null;
  bannerCurrentRoadRef?: string | null;
  bannerTravelingStepIndex?: number | null;
  personalForkShowChip: boolean;
  personalForkShowCommittedChip: boolean;
  personalForkOffer: PersonalForkOffer | null;
  onTakePersonalFork: () => void;
  onDismissPersonalFork: () => void;
  showStormAdvisoryChrome: boolean;
  stormAdvisoryBarProps: StormAdvisoryBarProps;
  isPlus: boolean;
  activityBusyLabel: string | null;
  /** Short status chip (refresh, route saved). Sits under the advisory bar. */
  dockNote: { text: string; tone: "warn" | "info" } | null;
  radarMapOverlayOn: boolean;
  radarFrameClockLabel: string | null;
  hazardApproachAlertsActive: boolean;
  driveApproachBannerPick: DriveApproachBannerPick;
  /** Jam-hop strip — rendered inside the cluster so it gets sizing + pointer events. */
  jamHopSlot?: ReactNode;
  hazardTickerSlot?: ReactNode;
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
  bannerInstructionOverride = null,
  bannerCurrentRoadName = null,
  bannerCurrentRoadRef = null,
  bannerTravelingStepIndex = null,
  personalForkShowChip,
  personalForkShowCommittedChip,
  personalForkOffer,
  onTakePersonalFork,
  onDismissPersonalFork,
  showStormAdvisoryChrome,
  stormAdvisoryBarProps,
  isPlus,
  activityBusyLabel,
  dockNote,
  radarMapOverlayOn,
  radarFrameClockLabel,
  hazardApproachAlertsActive,
  driveApproachBannerPick,
  jamHopSlot = null,
  hazardTickerSlot = null,
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
            instructionOverride={bannerInstructionOverride}
            currentRoadName={bannerCurrentRoadName}
            currentRoadRef={bannerCurrentRoadRef}
            travelingStepIndex={bannerTravelingStepIndex}
            glanceable={navigationStarted}
          />
          {hazardTickerSlot}
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
          {dockNote ? (
            <LandscapeDockContent active={navigationStarted}>
              <div className="nav-toast-stack nav-toast-stack--under-advisory" role="status" aria-live="polite">
                <div className={`nav-toast nav-toast-${dockNote.tone}`}>{dockNote.text}</div>
              </div>
            </LandscapeDockContent>
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
          {jamHopSlot}
        </div>
      </div>
    </div>
  );
}
