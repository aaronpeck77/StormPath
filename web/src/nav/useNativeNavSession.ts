import { useCallback, useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import {
  StormpathMapboxNavigation,
  type NativeNavGuidance,
  type NativeNavProgressEvent,
  type NativeNavRouteChangedEvent,
} from "@stormpath/mapbox-navigation";
import { recordMapboxUsage } from "../monitoring/mapboxUsageMeter";
import { DRIVE_AHEAD_NAV_START_GRACE_MS } from "./driveAlwaysAhead";
import { buildNativeGuidanceCoordinates } from "./nativeGuidanceCoords";
import type { LngLat, RouteTurnStep } from "./types";
import type { TripStop } from "./routeWaypoints";
import type { NavigationPositionState } from "../hooks/useNavigationPosition";

export type NativeNavSessionCoords = {
  userLngLat: LngLat | null;
  viaStops: TripStop[];
  destLngLat: LngLat | null;
  /** Go-locked corridor — seed Core so it does not yank to highway-fastest. */
  lockedCorridor?: LngLat[] | null;
};

export type { NativeNavGuidance };

function parseNativeTurnSteps(
  raw: NativeNavRouteChangedEvent["turnSteps"]
): RouteTurnStep[] {
  if (!raw?.length) return [];
  const out: RouteTurnStep[] = [];
  for (const s of raw) {
    const instruction = typeof s.instruction === "string" ? s.instruction.trim() : "";
    if (!instruction) continue;
    const step: RouteTurnStep = { instruction };
    if (typeof s.distanceM === "number" && Number.isFinite(s.distanceM)) {
      step.distanceM = s.distanceM;
    }
    if (typeof s.maneuverType === "string" && s.maneuverType.trim()) {
      step.maneuverType = s.maneuverType.trim();
    }
    if (typeof s.maneuverModifier === "string" && s.maneuverModifier.trim()) {
      step.maneuverModifier = s.maneuverModifier.trim();
    }
    if (typeof s.exitNumber === "string" && s.exitNumber.trim()) {
      step.exitNumber = s.exitNumber.trim();
    }
    if (typeof s.roadName === "string" && s.roadName.trim()) {
      step.roadName = s.roadName.trim();
    }
    if (typeof s.roadRef === "string" && s.roadRef.trim()) {
      step.roadRef = s.roadRef.trim();
    }
    out.push(step);
  }
  return out;
}

function buildCoordinateList(c: NativeNavSessionCoords): { lng: number; lat: number }[] | null {
  return buildNativeGuidanceCoordinates(c);
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
  /**
   * When SDK starts or reroutes, adopt geometry into the locked guidance corridor.
   * Mid-trip Core reroutes must use `{ force: true }` — freezing the original Go
   * polyline leaves Drive with no blue line (alongM is on the new route).
   * Returns false when session-start Core geometry was rejected (keep Go lock).
   */
  onRouteGeometry: (geometry: LngLat[], opts?: { force?: boolean }) => boolean | void;
  /** Optional: arrive / hard error — App may End trip. */
  onSessionEnded?: (reason: "arrived" | "cancelled" | "error", message?: string) => void;
  simulate?: boolean;
  /** Info → Voice prompts; must mute Mapbox RouteVoiceController when false. */
  voiceGuidanceEnabled?: boolean;
  /** Prefer no-interstate when the Go-locked leg is a preferred / slower alternate. */
  preferBackroads?: boolean;
}) {
  const {
    accessToken,
    navigationStarted,
    coords,
    onRouteGeometry,
    onSessionEnded,
    simulate,
    voiceGuidanceEnabled = false,
    preferBackroads = false,
  } = opts;
  const voiceGuidanceEnabledRef = useRef(voiceGuidanceEnabled);
  voiceGuidanceEnabledRef.current = voiceGuidanceEnabled;
  const preferBackroadsRef = useRef(preferBackroads);
  preferBackroadsRef.current = preferBackroads;

  const [nativeNavActive, setNativeNavActive] = useState(false);
  const [position, setPosition] = useState<NavigationPositionState | null>(null);
  const [guidance, setGuidance] = useState<NativeNavGuidance | null>(null);
  const [turnSteps, setTurnSteps] = useState<RouteTurnStep[]>([]);
  const startedForNavRef = useRef(false);
  /** After Go-start grace, later Core updates are mid-trip reroutes (force-adopt). */
  const allowForceAdoptRef = useRef(false);
  const forceAdoptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listenersRef = useRef<{ remove: () => Promise<void> }[]>([]);
  const onRouteGeometryRef = useRef(onRouteGeometry);
  onRouteGeometryRef.current = onRouteGeometry;
  const onSessionEndedRef = useRef(onSessionEnded);
  onSessionEndedRef.current = onSessionEnded;
  const coordsRef = useRef(coords);
  coordsRef.current = coords;

  const clearForceAdoptTimer = useCallback(() => {
    if (forceAdoptTimerRef.current != null) {
      clearTimeout(forceAdoptTimerRef.current);
      forceAdoptTimerRef.current = null;
    }
  }, []);

  const removeListeners = useCallback(async () => {
    const list = listenersRef.current;
    listenersRef.current = [];
    await Promise.all(list.map((l) => l.remove().catch(() => undefined)));
  }, []);

  const stopNative = useCallback(async () => {
    await removeListeners();
    clearForceAdoptTimer();
    try {
      if (isNativeMapboxNavPlatform()) {
        await StormpathMapboxNavigation.stop();
      }
    } catch {
      /* ignore */
    }
    startedForNavRef.current = false;
    allowForceAdoptRef.current = false;
    setNativeNavActive(false);
    setPosition(null);
    setGuidance(null);
    setTurnSteps([]);
  }, [removeListeners, clearForceAdoptTimer]);

  const startNative = useCallback(async () => {
    if (!isNativeMapboxNavPlatform()) return false;
    if (!accessToken) return false;
    const coordinates = buildCoordinateList(coordsRef.current);
    if (!coordinates) return false;

    try {
      const avail = await StormpathMapboxNavigation.isAvailable();
      if (!avail.available) return false;

      await removeListeners();
      clearForceAdoptTimer();
      allowForceAdoptRef.current = false;

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
          const roadName =
            typeof e.currentRoadName === "string" && e.currentRoadName.trim()
              ? e.currentRoadName.trim()
              : null;
          const roadRef =
            typeof e.currentRoadRef === "string" && e.currentRoadRef.trim()
              ? e.currentRoadRef.trim()
              : null;
          setGuidance({
            stepIndex: Number.isFinite(e.stepIndex) ? e.stepIndex : 0,
            stepRemainingM: stepRem,
            instruction: instr,
            currentRoadName: roadName,
            currentRoadRef: roadRef,
          });
        }),
        StormpathMapboxNavigation.addListener("routeChanged", (e: NativeNavRouteChangedEvent) => {
          const geom = (e.geometry ?? [])
            .filter((p) => Number.isFinite(p.lng) && Number.isFinite(p.lat))
            .map((p) => [p.lng, p.lat] as LngLat);
          /* Session start (possibly double-emitted): never force — keep Go alternate.
           * After the post-start grace window, Core mid-trip reroutes may force-adopt. */
          const force = allowForceAdoptRef.current;
          const adopted =
            geom.length >= 2 ? onRouteGeometryRef.current(geom, { force }) !== false : false;
          const steps = parseNativeTurnSteps(e.turnSteps);
          /* Only replace turn list when the corridor was accepted — otherwise keep
           * planning steps for the Go-locked alternate. */
          if (adopted && steps.length) setTurnSteps(steps);
        }),
        StormpathMapboxNavigation.addListener("arrived", () => {
          void stopNative().then(() => onSessionEndedRef.current?.("arrived"));
        }),
        StormpathMapboxNavigation.addListener("cancelled", () => {
          startedForNavRef.current = false;
          allowForceAdoptRef.current = false;
          setNativeNavActive(false);
          setPosition(null);
          setGuidance(null);
          setTurnSteps([]);
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
        preferBackroads: preferBackroadsRef.current,
      });
      if (!result.ok) {
        await removeListeners();
        return false;
      }
      recordMapboxUsage("navTrips");
      clearForceAdoptTimer();
      forceAdoptTimerRef.current = setTimeout(() => {
        allowForceAdoptRef.current = true;
        forceAdoptTimerRef.current = null;
      }, DRIVE_AHEAD_NAV_START_GRACE_MS);
      setNativeNavActive(true);
      return true;
    } catch (err) {
      console.warn("[nativeNav] start failed", err);
      await removeListeners();
      clearForceAdoptTimer();
      setNativeNavActive(false);
      return false;
    }
  }, [accessToken, removeListeners, clearForceAdoptTimer, simulate, stopNative]);

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
    /** Live Mapbox Core banner fields (instruction + distance). */
    guidance,
    /** Live Mapbox Core turn list — same route as the blue line / voice. */
    turnSteps,
    stopNative,
  };
}
