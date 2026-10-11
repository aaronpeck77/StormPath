import { useState } from "react";
import { PASSENGER_TURN_QUIET_M } from "../nav/passengerAdvisory";
import { askStormy } from "../stormy/askStormy";
import { listenForStormy } from "../stormy/listenForStormy";
import type { StormyPacket } from "../stormy/stormyFence";
import { speakStormpathLine } from "../services/stormpathSpeech";

type Props = {
  packet: StormyPacket;
};

type Phase = "idle" | "listening" | "thinking";

/**
 * One tap to talk to Stormy. She is on the map at every stage.
 * A close turn keeps the button quiet so navigation can speak.
 */
export function StormyButton({ packet }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [note, setNote] = useState("");
  const turnSoon = packet.driving && packet.turnImminent;

  async function onTalk() {
    if (phase !== "idle" || turnSoon) return;
    setNote("");
    setPhase("listening");
    try {
      const question = await listenForStormy();
      if (!question) {
        setNote("Didn't catch that.");
        setPhase("idle");
        return;
      }
      setPhase("thinking");
      const reply = await askStormy({ ...packet, question });
      if (reply.action === "quiet" || !reply.say) {
        setNote(reply.action === "quiet" ? "Quiet." : "");
        setPhase("idle");
        return;
      }
      setNote(reply.needsYes ? reply.say : "");
      await speakStormpathLine(reply.say, { interrupt: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setNote(/hear|denied|unavailable|microphone/i.test(message) ? "No mic" : "No answer");
    } finally {
      setPhase("idle");
    }
  }

  const label =
    phase === "listening" ? "Listening" : phase === "thinking" ? "…" : note || "Stormy";
  return (
    <button
      type="button"
      className={`stormy-call-btn${phase !== "idle" ? " stormy-call-btn--busy" : ""}`}
      aria-label="Talk to Stormy"
      title={turnSoon ? "A turn is coming. Stormy will wait." : note || "Talk to Stormy"}
      disabled={turnSoon || phase !== "idle"}
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
