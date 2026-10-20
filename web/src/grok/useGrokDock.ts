import { useEffect, useRef } from "react";
import { useTripPlanStore } from "../state/tripPlanStore";
import type { ComputeRoutesFn } from "../nav/useComputeRoutes";
import type { LngLat } from "../nav/types";
import type { DockControl, DockMessage, DockPlan } from "./grokDock";
import { speakStormpathLine, waitUntilTurnFloor } from "../services/stormpathSpeech";
import { stormyTurnImminent } from "../ui/StormyButton";
import { spokenLanguageTag } from "../utils/guidanceLanguage";
import { useSettingsStore } from "../state/settingsStore";
import { voiceSpeaks } from "../voice/voiceLevel";
import {
  postDockOrigin,
  publishDockMessages,
  readAppliedPlanId,
  readDockCode,
  readDockState,
  readHeardMessageId,
  rememberAppliedPlanId,
  rememberHeardMessageId,
  readAppliedControlId,
  rememberAppliedControlId,
} from "./grokDockClient";

/**
 * Quiet unless the assistant switch is on and Info has a code.
 * Turning voice off leaves the saved code alone and does not let the assistant drive.
 */
export function useGrokDock(opts: {
  userLngLat: LngLat | null;
  navigationStarted: boolean;
  /** Updated later in the same render, after the maneuver distance exists. */
  turnMetersRef: { current: number | null };
  computeRoutes: ComputeRoutesFn;
  setTapHint: (msg: string | null) => void;
  onStartDrive: () => void;
  onStopDrive: () => void;
}): void {
  const { userLngLat, navigationStarted, turnMetersRef, computeRoutes, setTapHint, onStartDrive, onStopDrive } = opts;
  const setViaStops = useTripPlanStore((s) => s.setViaStops);
  const guidanceLanguage = useSettingsStore((s) => s.guidanceLanguage);
  const assistantEnabled = useSettingsStore((s) => s.assistantEnabled);
  const voiceLevel = useSettingsStore((s) => s.voiceLevel);
  const startRef = useRef(onStartDrive);
  const stopRef = useRef(onStopDrive);
  const navRef = useRef(navigationStarted);
  const voiceRef = useRef(voiceLevel);
  startRef.current = onStartDrive;
  stopRef.current = onStopDrive;
  navRef.current = navigationStarted;
  voiceRef.current = voiceLevel;

  useEffect(() => {
    const code = readDockCode();
    if (!assistantEnabled || !code) return;
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      if (userLngLat) {
        try {
          await postDockOrigin(code, userLngLat[0], userLngLat[1]);
        } catch {
          /* The next poll tries again. */
        }
      }
      let state: { plan: DockPlan | null; messages: DockMessage[]; control: DockControl | null };
      try {
        state = await readDockState(code);
      } catch {
        return;
      }
      publishDockMessages(state.messages);
      const heard = readHeardMessageId();
      const heardAt = state.messages.findIndex((row) => row.id === heard);
      const unheard = state.messages.filter((_, index) => (heard ? index > heardAt : true));
      if (unheard.length > 0) {
        const language = spokenLanguageTag(guidanceLanguage);
        for (const message of unheard) {
          if (cancelled) return;
          rememberHeardMessageId(message.id);
          await waitUntilTurnFloor(
            () => voiceSpeaks(voiceRef.current) && stormyTurnImminent(navRef.current, turnMetersRef.current)
          );
          if (cancelled) return;
          await speakStormpathLine(message.text, { interrupt: false, language });
        }
      }
      const plan = state.plan;
      if (!navigationStarted && plan && plan.id !== readAppliedPlanId()) {
        rememberAppliedPlanId(plan.id);
        if (plan.stop && plan.stopLabel) setViaStops([{ lngLat: plan.stop, label: plan.stopLabel }]);
        else setViaStops([]);
        await computeRoutes(plan.destination, plan.destinationLabel);
        if (state.control?.action !== "start") {
          setTapHint("Your assistant set this route. Hit Go when you are ready to leave.");
          window.setTimeout(() => setTapHint(null), 8000);
        }
      }
      const control = state.control;
      if (control && control.id !== readAppliedControlId()) {
        rememberAppliedControlId(control.id);
        if (control.action === "stop" && navigationStarted) stopRef.current();
        else if (control.action === "start" && !navigationStarted) startRef.current();
      }
    };

    void tick();
    const timer = window.setInterval(() => void tick(), 8_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [assistantEnabled, computeRoutes, guidanceLanguage, navigationStarted, setTapHint, setViaStops, userLngLat]);
}
