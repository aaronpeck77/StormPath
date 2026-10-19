import { useState } from "react";
import { GROK_DOCK_URL } from "../grok/grokDock";
import { connectDock, forgetDockCode, readDockCode } from "../grok/grokDockClient";

export function GrokDockCard() {
  const [code, setCode] = useState(readDockCode);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const connect = async () => {
    setBusy(true);
    setNote("");
    try {
      const next = await connectDock();
      setCode(next);
    } catch {
      setNote("The connector is not reachable yet. Try again in a few minutes.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="about-sheet__details about-sheet__settings-card">
      <summary>Your assistant</summary>
      <p className="about-sheet__p">
        This connects the chatbot you already use. Stormy stays here in StormPath. Your assistant keeps its own voice.
        You still hit Go.
      </p>
      {code ? (
        <>
          <p className="about-sheet__p">
            Tell Grok: <strong>Use StormPath code {code}.</strong> Then ask him to plan the trip.
          </p>
          <button
            type="button"
            className="about-sheet__btn about-sheet__btn--ghost"
            onClick={() => {
              forgetDockCode();
              setCode("");
            }}
          >
            Disconnect
          </button>
        </>
      ) : (
        <button type="button" className="about-sheet__btn" disabled={busy} onClick={() => void connect()}>
          {busy ? "Connecting…" : "Connect Grok"}
        </button>
      )}
      {note ? <p className="about-sheet__p">{note}</p> : null}
      <p className="about-sheet__muted-line">
        First time only, in Grok open Connectors, choose New Connector, then Custom, and paste this address:{" "}
        {GROK_DOCK_URL}
      </p>
    </details>
  );
}
