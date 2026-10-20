import { useEffect, useState } from "react";
import { StormpathSpeech } from "@stormpath/speech";
import { GROK_DOCK_URL, type DockMessage } from "../grok/grokDock";
import {
  connectDock,
  forgetDockCode,
  readDockCode,
  sendToAssistant,
  subscribeDockMessages,
} from "../grok/grokDockClient";
import { useSettingsStore } from "../state/settingsStore";

export function GrokDockCard() {
  const [code, setCode] = useState(readDockCode);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [text, setText] = useState("");
  const [messages, setMessages] = useState<DockMessage[]>([]);
  const [copied, setCopied] = useState<"" | "address" | "sentence">("");
  const assistantName = useSettingsStore((s) => s.assistantName);
  const setAssistantName = useSettingsStore((s) => s.setAssistantName);

  useEffect(() => subscribeDockMessages(setMessages), []);

  const connect = async () => {
    setBusy(true);
    setNote("");
    try {
      const next = await connectDock();
      setCode(next);
      setMessages([]);
    } catch {
      setNote("The connector is not reachable yet. Try again in a few minutes.");
    } finally {
      setBusy(false);
    }
  };

  const send = async (line: string) => {
    const said = line.trim();
    if (!code || !said) return;
    setBusy(true);
    setNote("");
    let location: { lat: number; lng: number } | undefined;
    if (typeof navigator !== "undefined" && navigator.geolocation) {
      location = await new Promise((resolve) => {
        const timer = window.setTimeout(() => resolve(undefined), 2500);
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            window.clearTimeout(timer);
            resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          },
          () => {
            window.clearTimeout(timer);
            resolve(undefined);
          },
          { enableHighAccuracy: false, timeout: 2000, maximumAge: 15000 }
        );
      });
    }
    try {
      const error = await sendToAssistant(code, said, location);
      if (error) setNote(error);
      else {
        setText("");
        setNote("Sent to your assistant.");
      }
    } catch {
      setNote("The assistant did not accept that.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async (kind: "address" | "sentence", value: string) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const area = document.createElement("textarea");
      area.value = value;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.left = "-9999px";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopied(kind);
    window.setTimeout(() => setCopied(""), 2000);
  };

  const dictate = async () => {
    setNote("");
    try {
      const heard = await StormpathSpeech.listen();
      if (heard.text) setText(heard.text);
      else setNote("Didn't catch that. Type it instead.");
    } catch {
      setNote("Didn't catch that. Type it instead.");
    }
  };

  return (
    <div className="about-sheet__assistant-setup">
      <p className="about-sheet__p">
        This connects the chatbot you already use. One press asks once. Double tap or hold to keep talking. The map
        stays on screen.
      </p>
      <label className="about-sheet__setting about-sheet__setting--stack">
        <span>
          <strong>What do you call them?</strong>
        </span>
        <input
          className="about-sheet__support-note"
          value={assistantName}
          maxLength={16}
          placeholder="Steve"
          onChange={(e) => setAssistantName(e.target.value)}
        />
      </label>
      {code ? (
        <>
          <p className="about-sheet__p">
            Tell Grok or ChatGPT once: <strong>Use StormPath code {code}.</strong> Leave this connected. You do not paste a new code each day.
          </p>
          <button type="button" className="about-sheet__btn about-sheet__btn--ghost" onClick={() => void copy("sentence", `Use StormPath code ${code}.`)}>
            {copied === "sentence" ? "Copied" : "Copy that sentence"}
          </button>
          <label className="about-sheet__setting about-sheet__setting--stack">
            <span>
              <strong>Talk to assistant</strong>
            </span>
            <textarea
              className="about-sheet__support-note"
              rows={3}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Plan a route to Disney World"
            />
          </label>
          <div className="about-sheet__help-actions">
            <button type="button" className="about-sheet__btn" disabled={busy || !text.trim()} onClick={() => void send(text)}>
              {busy ? "Sending…" : "Send"}
            </button>
            <button type="button" className="about-sheet__btn about-sheet__btn--ghost" disabled={busy} onClick={() => void dictate()}>
              Speak
            </button>
            <button
              type="button"
              className="about-sheet__btn about-sheet__btn--ghost"
              onClick={() => {
                forgetDockCode();
                setCode("");
                setMessages([]);
              }}
            >
              Disconnect
            </button>
          </div>
          {messages.length > 0 ? (
            <ul className="about-sheet__p">
              {messages.slice(-8).map((message) => (
                <li key={message.id}>{message.text}</li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <>
          <p className="about-sheet__p">
            <strong>Connect</strong> makes a code for this phone. Copy that sentence into Grok or ChatGPT once, then leave
            it connected. Tap it again only after Disconnect, and the new code replaces the old one.
          </p>
          <button type="button" className="about-sheet__btn" disabled={busy} onClick={() => void connect()}>
            {busy ? "Connecting…" : "Connect"}
          </button>
        </>
      )}
      {note ? <p className="about-sheet__p">{note}</p> : null}
      <div className="about-sheet__p about-sheet__settings-card">
        <strong>First time only.</strong>
        <p className="about-sheet__p about-sheet__p--tight">
          Do this once. The address is the same for Grok and ChatGPT. Pasting in a chat does not save it.
        </p>
        <p className="about-sheet__p about-sheet__p--tight">{GROK_DOCK_URL}</p>
        <button type="button" className="about-sheet__btn" onClick={() => void copy("address", GROK_DOCK_URL)}>
          {copied === "address" ? "Copied" : "Copy address"}
        </button>
        <p className="about-sheet__p about-sheet__p--tight">
          <strong>Grok</strong>
        </p>
        <ol className="about-sheet__bullets">
          <li>In Grok, open Connectors.</li>
          <li>Choose New Connector, then Custom.</li>
          <li>Name it StormPath.</li>
          <li>Tap Copy address, then paste it into the address field.</li>
        </ol>
        <p className="about-sheet__p about-sheet__p--tight">
          <strong>ChatGPT</strong>
        </p>
        <p className="about-sheet__p about-sheet__p--tight">On the ChatGPT website.</p>
        <ol className="about-sheet__bullets">
          <li>Open Plugins.</li>
          <li>Tap the plus, then Add custom MCP server.</li>
          <li>Name it StormPath.</li>
          <li>Under Connection, paste the address. Choose No authentication.</li>
          <li>Check I understand and want to continue, then Create.</li>
          <li>In a new chat, type @ and choose StormPath, then paste the sentence.</li>
        </ol>
        <p className="about-sheet__p about-sheet__p--tight">
          ChatGPT may ask before it starts or stops the drive. A Plus or Pro plan may only be allowed to look. A Business
          plan can run the trip.
        </p>
      </div>
    </div>
  );
}
