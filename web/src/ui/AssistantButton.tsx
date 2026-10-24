import { useEffect, useRef, useState } from "react";
import { holdAppVoice, holdForSpokenReply, noteAssistantTalk, releaseAppVoice, setAssistantSessionOpen } from "../grok/assistantFloor";
import { assistantListenNote, isMicDenied, isTransientMicFailure } from "../grok/assistantListen";
import { assistantBrief, fallbackSpeech, isTripAction, isTripTalk } from "../grok/assistantTurn";
import { readDockCode, readDockState, readHeardMessageId, rememberHeardMessageId, sendToAssistant } from "../grok/grokDockClient";
import { listenForStormy } from "../stormy/listenForStormy";
import { interpretStormyRequest } from "../stormy/stormyHands";
import type { StormyActResult, StormyPacket, StormyReply } from "../stormy/stormyFence";
import { speakStormpathLine, waitUntilSpeechDone, waitUntilTurnFloor } from "../services/stormpathSpeech";
import { voiceSpeaks } from "../voice/voiceLevel";
import { useSettingsStore } from "../state/settingsStore";

type Props = {
  name: string;
  packet: StormyPacket;
  onAct?: (reply: StormyReply) => Promise<StormyActResult>;
};

type Phase = "idle" | "listening" | "thinking" | "speaking";

const EMPTY: Omit<StormyReply, "say" | "action"> = {
  needsYes: false,
  place: "",
  routeId: "",
  drive: false,
  stop: false,
  thenPlace: "",
  clarify: "",
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

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
 * One press: one request, then the mic closes after the reply finishes.
 * Double tap or a long press: listen again only after that reply has been spoken.
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

  function still(id: number): boolean {
    return runId.current === id;
  }

  async function speakLine(
    line: string,
    forAssistant: boolean,
    id: number,
    onStarted?: () => void
  ): Promise<boolean> {
    const said = line.replace(/\s+/g, " ").trim();
    if (!said || !still(id)) return false;
    await waitUntilTurnFloor(() => voiceOnRef.current && packetRef.current.turnImminent);
    if (!still(id)) return false;
    let spoke = await speakStormpathLine(said, { interrupt: false, forAssistant });
    if (!spoke && still(id)) {
      await waitUntilSpeechDone(() => still(id));
      if (!still(id)) return false;
      spoke = await speakStormpathLine(said, { interrupt: false, forAssistant });
    }
    if (!spoke) return false;
    onStarted?.();
    await waitUntilSpeechDone(() => still(id));
    return still(id);
  }

  /** A reply that landed on the dock while the mic was down gets said before the next listen. */
  async function drainUnheard(id: number): Promise<void> {
    const code = readDockCode();
    const heard = readHeardMessageId();
    if (!code || !heard || !still(id)) return;
    let messages;
    try {
      messages = (await readDockState(code)).messages;
    } catch {
      return;
    }
    const heardAt = messages.findIndex((row) => row.id === heard);
    if (heardAt < 0) return;
    for (const message of messages.slice(heardAt + 1)) {
      if (!still(id)) return;
      setPhase("speaking");
      let started = false;
      const finished = await speakLine(message.text, true, id, () => {
        started = true;
        rememberHeardMessageId(message.id);
      });
      if (!still(id) || (!finished && !started)) return;
    }
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
      if (!still(id)) return false;
      if (outcome && typeof outcome === "object") {
        if (outcome.say) {
          setPhase("speaking");
          await speakLine(outcome.say, false, id);
        }
        return still(id);
      }
      let line = (typeof outcome === "string" ? outcome : "") || reply.say;
      const found = line && !/couldn't find|where do you/i.test(line);
      if (reply.action === "go_to" && reply.drive && found) {
        const started = await onAct?.({ say: "Let's go.", action: "start_drive", ...EMPTY });
        if (!still(id)) return false;
        if (typeof started === "string" && started.trim()) line = started;
      }
      if (line) {
        setPhase("speaking");
        await speakLine(line, false, id);
      }
      return still(id);
    }
    const code = readDockCode();
    if (!code) {
      const line = fallbackSpeech("", reply?.say ?? "");
      if (line) {
        setPhase("speaking");
        await speakLine(line, false, id);
      } else setNote("Connect your assistant in Info.");
      return still(id);
    }
    const tripTalk = isTripTalk(question);
    noteAssistantTalk(tripTalk ? "trip" : "free");
    holdAppVoice(tripTalk ? 20_000 : 45_000);
    setPhase("thinking");
    const sent = await sendToAssistant(code, assistantBrief(question, packet));
    if (!still(id)) return false;
    if (!sent.ok) {
      releaseAppVoice();
      const line = fallbackSpeech(code, reply?.say ?? "");
      if (line) {
        setPhase("speaking");
        await speakLine(line, false, id);
      } else setNote(sent.error);
      return still(id);
    }
    holdReply.current = true;
    if (!sent.say) return false;
    holdForSpokenReply(sent.say);
    setPhase("speaking");
    await speakLine(sent.say, true, id, () => {
      if (sent.id) rememberHeardMessageId(sent.id);
    });
    return still(id);
  }

  async function hear(round: number, id: number): Promise<string | null> {
    const once = async (): Promise<string | null | undefined> => {
      try {
        return await listenForStormy();
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (isTransientMicFailure(message)) return undefined;
        if (round === 0 || isMicDenied(message)) setNote(assistantListenNote(message));
        return null;
      }
    };
    let heard = await once();
    if (heard === undefined) {
      await delay(450);
      if (!still(id)) return null;
      heard = await once();
      if (heard === undefined) {
        if (round === 0) setNote("Didn't catch that.");
        return null;
      }
    }
    return heard;
  }

  async function run(conversation: boolean) {
    if (phase !== "idle") {
      runId.current += 1;
      setOpenMic(false);
      setPhase("idle");
      setAssistantSessionOpen(false);
      releaseAppVoice();
      return;
    }
    const id = runId.current + 1;
    runId.current = id;
    holdReply.current = false;
    setNote("");
    setOpenMic(conversation);
    setAssistantSessionOpen(true);
    holdAppVoice(conversation ? 90_000 : 45_000);
    const playReady = armReadyChime();
    setPhase("speaking");
    try {
      await waitUntilSpeechDone(() => still(id));
      if (!still(id)) return;
      await drainUnheard(id);
      if (!still(id)) return;
      await delay(400);
      if (!still(id)) return;
      playReady();
      const rounds = conversation ? 8 : 1;
      for (let round = 0; round < rounds; round += 1) {
        if (!still(id)) return;
        await drainUnheard(id);
        if (!still(id)) return;
        setPhase("listening");
        const question = await hear(round, id);
        if (!still(id) || question == null) return;
        if (!question.trim()) {
          if (round === 0) setNote("Didn't catch that.");
          return;
        }
        const keep = await handleUtterance(question, id);
        if (!keep || !conversation || !still(id)) return;
        await delay(350);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setNote(assistantListenNote(message));
    } finally {
      if (still(id)) {
        setOpenMic(false);
        setPhase("idle");
        setAssistantSessionOpen(false);
        if (!holdReply.current) releaseAppVoice();
        holdReply.current = false;
      }
    }
  }

  const label =
    phase === "listening"
      ? openMic
        ? "Talking"
        : "Listening"
      : phase === "speaking"
        ? "Speaking"
        : phase === "thinking"
          ? "…"
          : note || name;

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
