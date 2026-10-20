import {
  GROK_DOCK_APPLIED_KEY,
  GROK_DOCK_CODE_KEY,
  GROK_DOCK_URL,
  newDockCode,
  type DockControl,
  type DockMessage,
  type DockPlan,
} from "./grokDock";
import { safeStorage } from "../storage/safeStorage";

export function readDockCode(): string {
  return safeStorage.get(GROK_DOCK_CODE_KEY)?.trim().toUpperCase() ?? "";
}

export function rememberDockCode(code: string): void {
  safeStorage.set(GROK_DOCK_CODE_KEY, code);
}

export function forgetDockCode(): void {
  safeStorage.remove(GROK_DOCK_CODE_KEY);
  safeStorage.remove(GROK_DOCK_APPLIED_KEY);
  safeStorage.remove("stormpath-grok-dock-control");
}

export function readAppliedPlanId(): string {
  return safeStorage.get(GROK_DOCK_APPLIED_KEY) ?? "";
}

export function rememberAppliedPlanId(id: string): void {
  safeStorage.set(GROK_DOCK_APPLIED_KEY, id);
}

export async function claimDockCode(code: string): Promise<boolean> {
  const res = await fetch(GROK_DOCK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "claim", code }),
  });
  return res.ok;
}

export async function connectDock(): Promise<string> {
  const code = newDockCode();
  const ok = await claimDockCode(code);
  if (!ok) throw new Error("The connector is not reachable yet.");
  rememberDockCode(code);
  return code;
}

export async function postDockOrigin(code: string, lng: number, lat: number): Promise<void> {
  await fetch(GROK_DOCK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "origin", code, lng, lat }),
  });
}

export async function readDockState(
  code: string
): Promise<{ plan: DockPlan | null; messages: DockMessage[]; control: DockControl | null }> {
  const res = await fetch(`${GROK_DOCK_URL}?code=${encodeURIComponent(code)}`);
  if (!res.ok) return { plan: null, messages: [], control: null };
  const data = (await res.json()) as {
    plan?: DockPlan | null;
    messages?: DockMessage[];
    control?: DockControl | null;
  };
  const control =
    data.control && (data.control.action === "start" || data.control.action === "stop") && data.control.id
      ? data.control
      : null;
  return { plan: data.plan ?? null, messages: data.messages ?? [], control };
}

const CONTROL_KEY = "stormpath-grok-dock-control";

export function readAppliedControlId(): string {
  return safeStorage.get(CONTROL_KEY) ?? "";
}

export function rememberAppliedControlId(id: string): void {
  safeStorage.set(CONTROL_KEY, id);
}

const HEARD_KEY = "stormpath-grok-dock-heard";

export function readHeardMessageId(): string {
  return safeStorage.get(HEARD_KEY) ?? "";
}

export function rememberHeardMessageId(id: string): void {
  safeStorage.set(HEARD_KEY, id);
}

type MessageListener = (messages: DockMessage[]) => void;
const listeners = new Set<MessageListener>();

export function publishDockMessages(messages: DockMessage[]): void {
  for (const listener of listeners) listener(messages);
}

export function subscribeDockMessages(listener: MessageListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export type AssistantSendResult =
  | { ok: true; say: string; id: string }
  | { ok: false; error: string };

/** Read the assistant's JSON. A 200 with no `say` is an older server; the dock still has the line. */
export function assistantSendFromResponse(statusOk: boolean, body: unknown): AssistantSendResult {
  if (!statusOk) {
    const error =
      body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error.trim()
        : "";
    return { ok: false, error: error || "The assistant did not accept that." };
  }
  const data = body && typeof body === "object" ? (body as { say?: unknown; id?: unknown }) : {};
  return {
    ok: true,
    say: typeof data.say === "string" ? data.say.replace(/\s+/g, " ").trim() : "",
    id: typeof data.id === "string" ? data.id : "",
  };
}

export async function sendToAssistant(
  code: string,
  text: string,
  location?: { lat: number; lng: number }
): Promise<AssistantSendResult> {
  const res = await fetch("https://stormpath2.netlify.app/.netlify/functions/grok-assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      dock_code: code,
      text,
      ...(location ? { location } : {}),
    }),
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return assistantSendFromResponse(res.ok, body);
}
