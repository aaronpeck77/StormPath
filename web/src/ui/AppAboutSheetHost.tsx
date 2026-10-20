import { lazy, Suspense, useMemo } from "react";
import type { HomePuckFollowMode } from "../map/homePuckFollow";
import type { ActivityTrailAboutPanel } from "../frequentRoutes/buildActivityTrailAboutPanel";
import { shouldShowManualOffRouteUi } from "../nav/constants";
import { payTierTestPanelEnabled } from "../config/env";
import { useSettingsStore } from "../state/settingsStore";
import { useUiStore } from "../state/uiStore";

const AboutSheet = lazy(() => import("./AboutSheet").then((m) => ({ default: m.AboutSheet })));

type Props = {
  payTierProbeKey: number;
  reprobePayTier: () => void;
  activityTrailAboutPanel: ActivityTrailAboutPanel | null;
  homePuckFollow: HomePuckFollowMode;
  onHomePuckFollowChange: (mode: HomePuckFollowMode) => void;
  tierLabel: string;
  onReplayCoachmarks: () => void;
  setTapHint: (hint: string | null) => void;
};

/** Lazy-loaded About / Settings sheet host — reads settings from the store. */
export function AppAboutSheetHost({
  payTierProbeKey,
  reprobePayTier,
  activityTrailAboutPanel,
  homePuckFollow,
  onHomePuckFollowChange,
  tierLabel,
  onReplayCoachmarks,
  setTapHint,
}: Props) {
  const aboutOpen = useUiStore((s) => s.aboutOpen);
  const setAboutOpen = useUiStore((s) => s.setAboutOpen);
  const applySettings = useSettingsStore((s) => s.applySettings);
  const radarEnabled = useSettingsStore((s) => s.radarEnabled);
  const radarDisplayMode = useSettingsStore((s) => s.radarDisplayMode);
  const stormEnabled = useSettingsStore((s) => s.stormEnabled);
  const trafficEnabled = useSettingsStore((s) => s.trafficEnabled);
  const weatherHintsEnabled = useSettingsStore((s) => s.weatherHintsEnabled);
  const dataSaverEnabled = useSettingsStore((s) => s.dataSaverEnabled);
  const autoRerouteEnabled = useSettingsStore((s) => s.autoRerouteEnabled);
  const voiceGuidanceEnabled = useSettingsStore((s) => s.voiceGuidanceEnabled);
  const voiceLevel = useSettingsStore((s) => s.voiceLevel);
  const assistantEnabled = useSettingsStore((s) => s.assistantEnabled);
  const assistantName = useSettingsStore((s) => s.assistantName);
  const gpsHighRefreshEnabled = useSettingsStore((s) => s.gpsHighRefreshEnabled);
  const mapMatchingEnabled = useSettingsStore((s) => s.mapMatchingEnabled);
  const landscapeSideHand = useSettingsStore((s) => s.landscapeSideHand);
  const puckColor = useSettingsStore((s) => s.puckColor);
  const guidanceLanguage = useSettingsStore((s) => s.guidanceLanguage);

  const settings = useMemo(
    () => ({
      radarEnabled,
      radarDisplayMode,
      stormEnabled,
      trafficEnabled,
      weatherHintsEnabled,
      dataSaverEnabled,
      autoRerouteEnabled,
      voiceGuidanceEnabled,
      voiceLevel,
      assistantEnabled,
      assistantName,
      gpsHighRefreshEnabled,
      mapMatchingEnabled,
      landscapeSideHand,
      puckColor,
      guidanceLanguage,
    }),
    [
      radarEnabled,
      radarDisplayMode,
      stormEnabled,
      trafficEnabled,
      weatherHintsEnabled,
      dataSaverEnabled,
      autoRerouteEnabled,
      voiceGuidanceEnabled,
      voiceLevel,
      assistantEnabled,
      assistantName,
      gpsHighRefreshEnabled,
      mapMatchingEnabled,
      landscapeSideHand,
      puckColor,
      guidanceLanguage,
    ]
  );

  return (
    <Suspense fallback={null}>
      <AboutSheet
        open={aboutOpen}
        onClose={() => setAboutOpen(false)}
        payTierProbeKey={payTierProbeKey}
        onPayTierOverride={
          import.meta.env.DEV || payTierTestPanelEnabled() ? reprobePayTier : undefined
        }
        activityTrail={activityTrailAboutPanel}
        homePuckFollow={homePuckFollow}
        onHomePuckFollowChange={onHomePuckFollowChange}
        settings={settings}
        onSettings={(next) => {
          applySettings(next);
          setTapHint(`Settings updated (${tierLabel}).`);
          window.setTimeout(() => setTapHint(null), 2500);
        }}
        onReplayCoachmarks={onReplayCoachmarks}
        liveRerouteEnabled={shouldShowManualOffRouteUi()}
      />
    </Suspense>
  );
}
