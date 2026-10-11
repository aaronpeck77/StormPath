import { useEffect, useState } from "react";
import { PASSENGER_TURN_QUIET_M } from "../nav/passengerAdvisory";
import { askStormy } from "../stormy/askStormy";
import { listenForStormy } from "../stormy/listenForStormy";
import type { StormyActResult, StormyPacket, StormyReply } from "../stormy/stormyFence";
import { interpretStormyRequest } from "../stormy/stormyHands";
import { isStormpathSpeechBusy, speakStormpathLine } from "../services/stormpathSpeech";

type Props = {
  packet: StormyPacket;
  /** Run a passenger action. Return a line to speak instead of the model's line. */
  onAct?: (reply: StormyReply) => Promise<StormyActResult>;
};

type Phase = "idle" | "hello" | "listening" | "thinking";

/** Built on the tap so iOS still allows sound after she says hello. */
function armStormyReadyChime(): () => void {
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
    osc.frequency.setValueAtTime(740, now);
    osc.frequency.exponentialRampToValueAtTime(988, now + 0.08);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.07, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.18);
    osc.onended = () => void ctx.close();
  };
}

function answeredPlace(
  question: string,
  clarify: "" | "place" | "choice",
  drive: boolean
): StormyReply {
  return {
    say: "",
    action: "go_to",
    needsYes: false,
    place: question,
    routeId: "",
    drive,
    clarify,
  };
}

function driverLine(line: string): string {
  if (!/\bpacket\b/i.test(line)) return line;
  return "Where do you want to go?";
}

async function waitUntilStormyQuiet(maxMs = 2200): Promise<void> {
  const start = Date.now();
  let heardHer = false;
  while (Date.now() - start < maxMs) {
    const busy = await isStormpathSpeechBusy();
    if (busy) heardHer = true;
    else if (heardHer || Date.now() - start > 400) return;
    await new Promise((resolve) => window.setTimeout(resolve, 70));
  }
}

/**
 * One tap to talk to Stormy. She stays on the map during a drive.
 * Turn prompts are not interrupted. The button stays tappable.
 */
export function StormyButton({ packet, onAct }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [note, setNote] = useState("");

  async function onTalk() {
    if (phase !== "idle") return;
    setNote("");
    const playReady = armStormyReadyChime();
    setPhase("hello");
    try {
      const spoke = await speakStormpathLine("Hello.");
      if (spoke) await waitUntilStormyQuiet();
      setPhase("listening");
      playReady();
      await new Promise((resolve) => window.setTimeout(resolve, 180));
      let question = await listenForStormy();
      let clarify: "" | "place" | "choice" = "";
      let drive = false;
      for (let round = 0; round < 3 && question; round += 1) {
        setPhase("thinking");
        const reply: StormyReply =
          clarify === "place" || clarify === "choice"
            ? answeredPlace(question, clarify, drive)
            : (interpretStormyRequest(question, packet) ?? (await askStormy({ ...packet, question })));
        if (reply.clarify === "place" && clarify !== "place") {
          drive = reply.drive;
          clarify = "place";
          setPhase("listening");
          await speakStormpathLine(reply.say, { interrupt: false });
          question = await listenForStormy();
          continue;
        }
        if (reply.action === "quiet") {
          setNote("Quiet.");
          return;
        }
        const outcome: StormyActResult = await onAct?.(reply);
        if (outcome && typeof outcome === "object") {
          drive = outcome.clarify === "place" || reply.drive;
          clarify = outcome.clarify;
          setPhase("listening");
          await speakStormpathLine(outcome.say, { interrupt: false });
          question = await listenForStormy();
          continue;
        }
        const spoken = driverLine((typeof outcome === "string" ? outcome : "") || reply.say);
        if (spoken) await speakStormpathLine(spoken, { interrupt: false });
        return;
      }
      if (!question) setNote("Didn't catch that.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setNote(/hear|denied|unavailable|microphone/i.test(message) ? "No mic" : "No answer");
    } finally {
      setPhase("idle");
    }
  }

  useEffect(() => {
    if (phase !== "idle" || !note) return;
    const timer = window.setTimeout(() => setNote(""), 3000);
    return () => window.clearTimeout(timer);
  }, [note, phase]);

  const label =
    phase === "hello"
      ? "Hello"
      : phase === "listening"
        ? "Listening"
        : phase === "thinking"
          ? "…"
          : note || "Stormy";
  return (
    <button
      type="button"
      className={`stormy-call-btn${phase !== "idle" ? " stormy-call-btn--busy" : ""}`}
      aria-label="Talk to Stormy"
      title={note || "Talk to Stormy"}
      disabled={phase !== "idle"}
      onClick={() => void onTalk()}
    >
      {label}
    </button>
  );
}

export function stormyTurnImminent(driving: boolean, metersToManeuver: number | null | undefined): boolean {
  return (
    driving &&
    metersToManeuver != null &&
    Number.isFinite(metersToManeuver) &&
    metersToManeuver < PASSENGER_TURN_QUIET_M
  );
}
