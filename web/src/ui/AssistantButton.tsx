import { useEffect, useRef, useState } from "react";
import { holdAppVoice, noteAssistantTalk, releaseAppVoice } from "../grok/assistantFloor";
import { assistantBrief, isTripAction, isTripTalk } from "../grok/assistantTurn";
import { readDockCode, sendToAssistant } from "../grok/grokDockClient";
import { listenForStormy } from "../stormy/listenForStormy";
import { interpretStormyRequest } from "../stormy/stormyHands";
import type { StormyActResult, StormyPacket, StormyReply } from "../stormy/stormyFence";
import { speakStormpathLine, waitUntilTurnFloor } from "../services/stormpathSpeech";
import { voiceSpeaks } from "../voice/voiceLevel";
import { useSettingsStore } from "../state/settingsStore";

type Props = {
  name: string;
  packet: StormyPacket;
  onAct?: (reply: StormyReply) => Promise<StormyActResult>;
};

type Phase = "idle" | "listening" | "thinking";

const EMPTY: Omit<StormyReply, "say" | "action"> = {
  needsYes: false,
  place: "",
  routeId: "",
  drive: false,
  stop: false,
  thenPlace: "",
  clarify: "",
};

function armReadyChime(): () => void {
  const Ctx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return () => {};
  const ctx = new Ctx();
  void ctx.resume();
  return () => {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(660, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.06, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.14);
    osc.onended = () => void ctx.close();
  };
}

/**
 * One press: one request, then the mic closes.
 * Double tap or a long press: keep listening while the map stays up, and stop when they go quiet.
 */
export function AssistantButton({ name, packet, onAct }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [note, setNote] = useState("");
  const [openMic, setOpenMic] = useState(false);
  const runId = useRef(0);
  const packetRef = useRef(packet);
  packetRef.current = packet;
  const voiceOn = useSettingsStore((s) => voiceSpeaks(s.voiceLevel));
  const voiceOnRef = useRef(voiceOn);
  voiceOnRef.current = voiceOn;
  const holdTimer = useRef<number | null>(null);
  const clickTimer = useRef<number | null>(null);
  const held = useRef(false);
  const clicks = useRef(0);
  const holdReply = useRef(false);

  useEffect(() => {
    if (phase !== "idle" || !note) return;
    const timer = window.setTimeout(() => setNote(""), 4000);
    return () => window.clearTimeout(timer);
  }, [note, phase]);

  function stopHold() {
    if (holdTimer.current != null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  }

  async function speak(line: string) {
    const said = line.replace(/\s+/g, " ").trim();
    if (!said) return;
    await waitUntilTurnFloor(() => voiceOnRef.current && packetRef.current.turnImminent);
    await speakStormpathLine(said, { interrupt: false });
  }

  async function handleUtterance(question: string, id: number): Promise<boolean> {
    const reply = interpretStormyRequest(question, packet);
    if (reply?.action === "quiet") {
      setNote("Quiet.");
      return false;
    }
    if (reply && isTripAction(reply.action)) {
      setPhase("thinking");
      const outcome = await onAct?.(reply);
      if (runId.current !== id) return false;
      if (outcome && typeof outcome === "object") {
        if (outcome.say) await speak(outcome.say);
        return true;
      }
      let line = (typeof outcome === "string" ? outcome : "") || reply.say;
      const found = line && !/couldn't find|where do you/i.test(line);
      if (reply.action === "go_to" && reply.drive && found) {
        const started = await onAct?.({ say: "Let's go.", action: "start_drive", ...EMPTY });
        if (runId.current !== id) return false;
        if (typeof started === "string" && started.trim()) line = started;
      }
      if (line) await speak(line);
      return true;
    }
    const code = readDockCode();
    if (!code) {
      if (reply?.say) await speak(reply.say);
      else setNote("Connect your assistant in Info.");
      return true;
    }
    const tripTalk = isTripTalk(question);
    noteAssistantTalk(tripTalk ? "trip" : "free");
    holdAppVoice(tripTalk ? 20_000 : 45_000);
    setPhase("thinking");
    const error = await sendToAssistant(code, assistantBrief(question, packet));
    if (!error) holdReply.current = true;
    else releaseAppVoice();
    if (runId.current !== id) return false;
    if (error) {
      if (reply?.say) await speak(reply.say);
      else setNote(error);
    }
    return true;
  }

  async function run(conversation: boolean) {
    if (phase !== "idle") {
      runId.current += 1;
      setOpenMic(false);
      setPhase("idle");
      return;
    }
    const id = runId.current + 1;
    runId.current = id;
    setNote("");
    setOpenMic(conversation);
    holdAppVoice(conversation ? 90_000 : 45_000);
    const playReady = armReadyChime();
    setPhase("listening");
    try {
      await new Promise((resolve) => window.setTimeout(resolve, 400));
      if (runId.current !== id) return;
      playReady();
      const rounds = conversation ? 8 : 1;
      for (let round = 0; round < rounds; round += 1) {
        if (runId.current !== id) return;
        setPhase("listening");
        const question = await listenForStormy();
        if (runId.current !== id) return;
        if (!question) {
          if (round === 0) setNote("Didn't catch that.");
          return;
        }
        const keep = await handleUtterance(question, id);
        if (!keep || !conversation) return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setNote(/hear|denied|unavailable|microphone/i.test(message) ? "No mic" : "No answer");
    } finally {
      if (runId.current === id) {
        setOpenMic(false);
        setPhase("idle");
        if (!holdReply.current) releaseAppVoice();
        holdReply.current = false;
      }
    }
  }

  const label =
    phase === "listening" ? (openMic ? "Talking" : "Listening") : phase === "thinking" ? "…" : note || name;

  return (
    <button
      type="button"
      className={`stormy-call-btn${phase !== "idle" ? " stormy-call-btn--busy" : ""}`}
      aria-label={`Talk to ${name}. Double tap or hold to keep the mic open.`}
      title="One press asks once. Hold or double tap to keep talking."
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={() => {
        stopHold();
        held.current = false;
        holdTimer.current = window.setTimeout(() => {
          held.current = true;
          holdTimer.current = null;
          void run(true);
        }, 550);
      }}
      onPointerUp={stopHold}
      onPointerLeave={stopHold}
      onClick={() => {
        if (held.current) {
          held.current = false;
          return;
        }
        clicks.current += 1;
        if (clicks.current === 1) {
          clickTimer.current = window.setTimeout(() => {
            clicks.current = 0;
            void run(false);
          }, 280);
          return;
        }
        if (clickTimer.current != null) window.clearTimeout(clickTimer.current);
        clicks.current = 0;
        void run(true);
      }}
    >
      {label}
    </button>
  );
}
