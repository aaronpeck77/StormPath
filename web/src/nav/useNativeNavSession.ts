import { useCallback, useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import {
  StormpathMapboxNavigation,
  type NativeNavGuidance,
  type NativeNavProgressEvent,
} from "@stormpath/mapbox-navigation";
import type { LngLat } from "./types";
import type { TripStop } from "./routeWaypoints";
import type { NavigationPositionState } from "../hooks/useNavigationPosition";

export type NativeNavSessionCoords = {
  userLngLat: LngLat | null;
  viaStops: TripStop[];
  destLngLat: LngLat | null;
};

export type { NativeNavGuidance };

function buildCoordinateList(c: NativeNavSessionCoords): { lng: number; lat: number }[] | null {
  if (!c.userLngLat || !c.destLngLat) return null;
  const out: { lng: number; lat: number }[] = [
    { lng: c.userLngLat[0], lat: c.userLngLat[1] },
  ];
  for (const stop of c.viaStops) {
    const v = stop?.lngLat;
    if (!v || v.length < 2) continue;
    out.push({ lng: v[0], lat: v[1] });
  }
  out.push({ lng: c.destLngLat[0], lat: c.destLngLat[1] });
  return out.length >= 2 ? out : null;
}

export function isNativeMapboxNavPlatform(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
}

/**
 * iOS: Mapbox Navigation Core under StormPath DriveMap.
 * Feeds the same position/along state Dr / Mp / Rt already share.
 * Web / Netlify: no-op (DIY nav stays active).
 */
export function useNativeNavSession(opts: {
  accessToken: string;
  navigationStarted: boolean;
  coords: NativeNavSessionCoords;
  /** When SDK reroutes, adopt geometry into locked guidance corridor. */
  onRouteGeometry: (geometry: LngLat[]) => void;
  /** Optional: arrive / hard error — App may End trip. */
  onSessionEnded?: (reason: "arrived" | "cancelled" | "error", message?: string) => void;
  simulate?: boolean;
  /** Info → Voice prompts; must mute Mapbox RouteVoiceController when false. */
  voiceGuidanceEnabled?: boolean;
}) {
  const {
    accessToken,
    navigationStarted,
    coords,
    onRouteGeometry,
    onSessionEnded,
    simulate,
    voiceGuidanceEnabled = false,
  } = opts;
  const voiceGuidanceEnabledRef = useRef(voiceGuidanceEnabled);
  voiceGuidanceEnabledRef.current = voiceGuidanceEnabled;

  const [nativeNavActive, setNativeNavActive] = useState(false);
  const [position, setPosition] = useState<NavigationPositionState | null>(null);
  const [guidance, setGuidance] = useState<NativeNavGuidance | null>(null);
  const startedForNavRef = useRef(false);
  const listenersRef = useRef<{ remove: () => Promise<void> }[]>([]);
  const onRouteGeometryRef = useRef(onRouteGeometry);
  onRouteGeometryRef.current = onRouteGeometry;
  const onSessionEndedRef = useRef(onSessionEnded);
  onSessionEndedRef.current = onSessionEnded;
  const coordsRef = useRef(coords);
  coordsRef.current = coords;

  const removeListeners = useCallback(async () => {
    const list = listenersRef.current;
    listenersRef.current = [];
    await Promise.all(list.map((l) => l.remove().catch(() => undefined)));
  }, []);

  const stopNative = useCallback(async () => {
    await removeListeners();
    try {
      if (isNativeMapboxNavPlatform()) {
        await StormpathMapboxNavigation.stop();
      }
    } catch {
      /* ignore */
    }
    startedForNavRef.current = false;
    setNativeNavActive(false);
    setPosition(null);
    setGuidance(null);
  }, [removeListeners]);

  const startNative = useCallback(async () => {
    if (!isNativeMapboxNavPlatform()) return false;
    if (!accessToken) return false;
    const coordinates = buildCoordinateList(coordsRef.current);
    if (!coordinates) return false;

    try {
      const avail = await StormpathMapboxNavigation.isAvailable();
      if (!avail.available) return false;

      await removeListeners();

      const handles = await Promise.all([
        StormpathMapboxNavigation.addListener("progress", (e: NativeNavProgressEvent) => {
          setPosition({
            positionLngLat: [e.lng, e.lat],
            alongM: e.alongM,
            onRoute: e.onRoute,
            source: "route_snap",
          });
          const instr =
            typeof e.instruction === "string" && e.instruction.trim()
              ? e.instruction.trim()
              : null;
          const stepRem =
            e.stepRemainingM != null && Number.isFinite(e.stepRemainingM)
              ? Math.max(0, e.stepRemainingM)
              : null;
          setGuidance({
            stepIndex: Number.isFinite(e.stepIndex) ? e.stepIndex : 0,
            stepRemainingM: stepRem,
            instruction: instr,
          });
        }),
        StormpathMapboxNavigation.addListener("routeChanged", (e) => {
          const geom = (e.geometry ?? [])
            .filter((p) => Number.isFinite(p.lng) && Number.isFinite(p.lat))
            .map((p) => [p.lng, p.lat] as LngLat);
          if (geom.length >= 2) onRouteGeometryRef.current(geom);
        }),
        StormpathMapboxNavigation.addListener("arrived", () => {
          void stopNative().then(() => onSessionEndedRef.current?.("arrived"));
        }),
        StormpathMapboxNavigation.addListener("cancelled", () => {
          startedForNavRef.current = false;
          setNativeNavActive(false);
          setPosition(null);
          setGuidance(null);
          onSessionEndedRef.current?.("cancelled");
        }),
        StormpathMapboxNavigation.addListener("error", (e) => {
          onSessionEndedRef.current?.("error", e.message);
        }),
      ]);
      listenersRef.current = handles;

      const result = await StormpathMapboxNavigation.startActiveGuidance({
        accessToken,
        coordinates,
        simulate: Boolean(simulate),
        voiceEnabled: voiceGuidanceEnabledRef.current,
      });
      if (!result.ok) {
        await removeListeners();
        return false;
      }
      setNativeNavActive(true);
      return true;
    } catch (err) {
      console.warn("[nativeNav] start failed", err);
      await removeListeners();
      setNativeNavActive(false);
      return false;
    }
  }, [accessToken, removeListeners, simulate, stopNative]);

  /** Start Core when Go flips navigationStarted; stop when trip ends. */
  useEffect(() => {
    if (!isNativeMapboxNavPlatform()) return;

    if (!navigationStarted) {
      if (startedForNavRef.current || nativeNavActive) {
        void stopNative();
      }
      return;
    }

    if (startedForNavRef.current) return;
    startedForNavRef.current = true;
    void startNative().then((ok) => {
      if (!ok) {
        // Fall back to DIY — leave navigationStarted true.
        startedForNavRef.current = false;
        setNativeNavActive(false);
      }
    });
  }, [navigationStarted, startNative, stopNative, nativeNavActive]);

  /** Mid-trip Info toggle — mute/unmute Mapbox voice without restarting Core. */
  useEffect(() => {
    if (!isNativeMapboxNavPlatform() || !nativeNavActive) return;
    void StormpathMapboxNavigation.setVoiceGuidance({
      enabled: voiceGuidanceEnabled,
    }).catch(() => undefined);
  }, [voiceGuidanceEnabled, nativeNavActive]);

  useEffect(() => {
    return () => {
      void stopNative();
    };
  }, [stopNative]);

  return {
    nativeNavActive,
    position,
    /** Banner authority on iOS Core — keep DIY turnSteps as icon fallback only. */
    guidance,
    stopNative,
  };
}
