import { Capacitor } from "@capacitor/core";
import { acceptStormyPacket, type StormyPacket, type StormyReply } from "./stormyFence";

const DEFAULT_STORMY_URL = "https://stormpath2.netlify.app/.netlify/functions/stormy";

export function getStormyUrl(): string {
  const custom = (import.meta.env.VITE_STORMY_URL as string | undefined)?.trim();
  if (custom) return custom;
  if (Capacitor.isNativePlatform()) return DEFAULT_STORMY_URL;
  if (typeof window !== "undefined") {
    const { hostname, protocol, origin } = window.location;
    if (protocol === "http:" && (hostname === "localhost" || hostname === "127.0.0.1")) {
      return DEFAULT_STORMY_URL;
    }
    if (origin.startsWith("http")) return `${origin}/.netlify/functions/stormy`;
  }
  return DEFAULT_STORMY_URL;
}

export async function askStormy(packet: StormyPacket): Promise<StormyReply> {
  const accepted = acceptStormyPacket(packet);
  if (!accepted.ok) throw new Error(accepted.error);
  const token = (import.meta.env.VITE_STORMY_CLIENT_TOKEN as string | undefined)?.trim();
  const response = await fetch(getStormyUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(accepted.packet),
  });
  const data = (await response.json().catch(() => null)) as StormyReply | { error?: string } | null;
  if (!response.ok || !data || !("say" in data)) {
    throw new Error("Stormy could not answer.");
  }
  return data;
}
