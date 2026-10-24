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
import { holdForSpokenReply, isAssistantSessionOpen } from "./assistantFloor";
import { assistantPlanApply } from "./grokPlanApply";
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
    let running = false;

    const tick = async () => {
      if (cancelled || running) return;
      running = true;
      try {
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
        // The map button speaks its own reply. A poll here would talk over the open mic.
        if (unheard.length > 0 && !isAssistantSessionOpen()) {
          const language = spokenLanguageTag(guidanceLanguage);
          for (const message of unheard) {
            if (cancelled || isAssistantSessionOpen()) break;
            holdForSpokenReply(message.text);
            await waitUntilTurnFloor(
              () => voiceSpeaks(voiceRef.current) && stormyTurnImminent(navRef.current, turnMetersRef.current)
            );
            if (cancelled || isAssistantSessionOpen()) break;
            const spoke = await speakStormpathLine(message.text, { interrupt: true, language, forAssistant: true });
            if (!spoke) break;
            rememberHeardMessageId(message.id);
          }
        }
        const plan = state.plan;
        const control = state.control;
        const planAction = assistantPlanApply({
          navigationStarted: navRef.current,
          planId: plan?.id ?? null,
          appliedPlanId: readAppliedPlanId(),
        });
        const controlFresh = Boolean(control && control.id !== readAppliedControlId());
        if (control && controlFresh) rememberAppliedControlId(control.id);
        if (plan && planAction !== "skip") {
          rememberAppliedPlanId(plan.id);
          if (plan.stop && plan.stopLabel) setViaStops([{ lngLat: plan.stop, label: plan.stopLabel }]);
          else setViaStops([]);
          const measured = await computeRoutes(plan.destination, plan.destinationLabel);
          let hint: string | null = null;
          if (!measured.ok) {
            if (measured.reason) hint = measured.reason;
          } else if (planAction === "replan-and-resume") {
            startRef.current();
            hint = plan.stop ? "Stop added. Measured again from here." : "Measured again from here.";
          } else if (control?.action !== "start") {
            hint = "Your assistant set this route. Hit Go when you are ready to leave.";
          }
          if (hint) {
            setTapHint(hint);
            window.setTimeout(() => setTapHint(null), 8000);
          }
        }
        if (control && controlFresh && planAction !== "replan-and-resume") {
          if (control.action === "stop" && navRef.current) stopRef.current();
          else if (control.action === "start" && !navRef.current) startRef.current();
        }
      } finally {
        running = false;
      }
    };

    void tick();
    const timer = window.setInterval(() => void tick(), 3_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [assistantEnabled, computeRoutes, guidanceLanguage, navigationStarted, setTapHint, setViaStops, userLngLat]);
}
