import { Capacitor } from "@capacitor/core";

const DEFAULT_TOKEN_URL = "https://stormpath2.netlify.app/.netlify/functions/weatherkit-token";

let tokenCache: { token: string; expiresAtMs: number } | null = null;
let tokenFetchChain: Promise<string> | null = null;
let lastTokenErrorAt = 0;

/** True for ~2 min after the token endpoint failed (mirrors Tomorrow.io cooldown UX). */
export function isWeatherKitTokenBlocked(): boolean {
  return Date.now() - lastTokenErrorAt < 2 * 60 * 1000;
}

export function clearWeatherKitTokenCache(): void {
  tokenCache = null;
  tokenFetchChain = null;
}

/** Where the app requests signed WeatherKit JWTs (Netlify function). */
export function getWeatherKitTokenUrl(): string {
  const custom = (import.meta.env.VITE_WEATHERKIT_TOKEN_URL as string | undefined)?.trim();
  if (custom) return custom;
  if (Capacitor.isNativePlatform()) return DEFAULT_TOKEN_URL;
  if (typeof window !== "undefined" && window.location.origin.startsWith("http")) {
    return `${window.location.origin}/.netlify/functions/weatherkit-token`;
  }
  return DEFAULT_TOKEN_URL;
}

export async function fetchWeatherKitToken(signal?: AbortSignal): Promise<string> {
  if (tokenCache && tokenCache.expiresAtMs > Date.now() + 60_000) {
    return tokenCache.token;
  }
  if (tokenFetchChain) return tokenFetchChain;

  tokenFetchChain = (async () => {
    const url = getWeatherKitTokenUrl();
    const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
    if (!res.ok) {
      lastTokenErrorAt = Date.now();
      throw new Error(`WeatherKit token ${res.status}`);
    }
    const data = (await res.json()) as { token?: string; expiresAtMs?: number };
    if (!data.token) {
      lastTokenErrorAt = Date.now();
      throw new Error("WeatherKit token missing");
    }
    tokenCache = {
      token: data.token,
      expiresAtMs: data.expiresAtMs ?? Date.now() + 3_500_000,
    };
    lastTokenErrorAt = 0;
    return tokenCache.token;
  })();

  try {
    return await tokenFetchChain;
  } finally {
    tokenFetchChain = null;
  }
}
