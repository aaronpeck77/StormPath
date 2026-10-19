import { GROK_DOCK_APPLIED_KEY, GROK_DOCK_CODE_KEY, GROK_DOCK_URL, newDockCode, type DockPlan } from "./grokDock";
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

export async function readDockPlan(code: string): Promise<DockPlan | null> {
  const res = await fetch(`${GROK_DOCK_URL}?code=${encodeURIComponent(code)}`);
  if (!res.ok) return null;
  const data = (await res.json()) as { plan?: DockPlan | null };
  return data.plan ?? null;
}
