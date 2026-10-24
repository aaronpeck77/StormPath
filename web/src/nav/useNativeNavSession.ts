import { useCallback, useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import {
  StormpathMapboxNavigation,
  type NativeNavGuidance,
  type NativeNavProgressEvent,
  type NativeNavRouteChangedEvent,
} from "@stormpath/mapbox-navigation";
import { recordMapboxUsage } from "../monitoring/mapboxUsageMeter";
import {
  computeLiveTripWindow,
  isPlanDestinationArrival,
  shouldHandoffLiveTripWindow,
  type LiveTripWindow,
} from "./liveTripWindow";
import { buildNativeGuidanceCoordinates } from "./nativeGuidanceCoords";
import {
  nativeRouteChangedShouldForce,
  shouldFeedNativeProgressToUi,
  shouldForceAdoptOffRouteNativeGeometry,
} from "./lockedRouteGeometryGuard";
import type { LngLat, RouteTurnStep } from "./types";
import type { TripStop } from "./routeWaypoints";
import type { NavigationPositionState } from "../hooks/useNavigationPosition";
import { bumpDriveDiag, noteDriveDiagRouteLock, resetDriveDiag } from "./driveDiagnostics";
import { downloadTripCorridor, removeTripCorridor } from "./offlineTripPacks";
import { useTripPlanStore } from "../state/tripPlanStore";
import { createNativeDrivePoseHold } from "./nativeDrivePoseHold";
import { NATIVE_DRIVE_MAP_ENABLED } from "./nativeDriveMapShell";
import type { CoreRerouteHealth } from "./rerouteOwner";
import {
  createNativeDriveFollowCam,
  parseNativeDriveFollowCamera,
  type NativeDriveFollowCamera,
} from "./nativeDriveFollowCam";
import {
  horizonHazardsFromProgress,
  horizonLimitMph,
  type HorizonHazard,
} from "./horizonAhead";
export type NativeNavSessionCoords = {
  userLngLat: LngLat | null;
  viaStops: TripStop[];
  destLngLat: LngLat | null;
  /** Planned / Go-locked corridor — seed Core so it does not yank to highway-fastest. */
  lockedCorridor?: LngLat[] | null;
  /** Travel heading at the origin so Core departs on the street you're on. */
  headingDeg?: number | null;
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

function buildCoordinateList(c: NativeNavSessionCoords) {
  return buildNativeGuidanceCoordinates(c);
}

function prepareRouteKey(c: NativeNavSessionCoords, preferBackroads: boolean, language: string): string {
  const dest = c.destLngLat;
  const corridor = c.lockedCorridor;
  if (!dest || !corridor || corridor.length < 2) return "";
  const last = corridor[corridor.length - 1]!;
  return `${dest[0].toFixed(4)},${dest[1].toFixed(4)}|${last[0].toFixed(4)},${last[1].toFixed(4)}|${corridor.length}|${preferBackroads ? "b" : "a"}|${language}`;
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
   * First emit: keep Go-locked B unless already off-route.
   * Later emits (Apple 4.20.7): Core's reroute IS the new lock — always force.
   */
  onRouteGeometry: (geometry: LngLat[], opts?: { force?: boolean }) => boolean | void;
  /** Optional: arrive / hard error — App may End trip. */
  onSessionEnded?: (reason: "arrived" | "cancelled" | "error", message?: string) => void;
  simulate?: boolean;
  /** Info → Voice prompts; must mute Mapbox RouteVoiceController when false. */
  voiceGuidanceEnabled?: boolean;
  /** Prefer no-interstate when the Go-locked leg is a preferred / slower alternate. */
  preferBackroads?: boolean;
  /** Mapbox turn language. "en" or the phone language. */
  guidanceLanguage?: string;
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
    guidanceLanguage = "en",
  } = opts;
  const voiceGuidanceEnabledRef = useRef(voiceGuidanceEnabled);
  voiceGuidanceEnabledRef.current = voiceGuidanceEnabled;
  const preferBackroadsRef = useRef(preferBackroads);
  preferBackroadsRef.current = preferBackroads;
  const guidanceLanguageRef = useRef(guidanceLanguage);
  guidanceLanguageRef.current = guidanceLanguage;

  const [nativeNavActive, setNativeNavActive] = useState(false);
  const [coreWindowIsFinal, setCoreWindowIsFinal] = useState(true);
  const [position, setPosition] = useState<NavigationPositionState | null>(null);
  const [followCamera, setFollowCamera] = useState<NativeDriveFollowCamera | null>(null);
  const [guidance, setGuidance] = useState<NativeNavGuidance | null>(null);
  const [turnSteps, setTurnSteps] = useState<RouteTurnStep[]>([]);
  const [horizonLimit, setHorizonLimit] = useState<number | null>(null);
  const [horizonHazards, setHorizonHazards] = useState<HorizonHazard[]>([]);
  const [horizonReady, setHorizonReady] = useState(false);
  const startedForNavRef = useRef(false);
  const nativeRestartingRef = useRef(false);
  /** Stop already in flight — do not tear Core down a second time from the nav-ended effect. */
  const nativeStoppingRef = useRef(false);
  /** Core calculated a different corridor — DIY owns this trip; do not restart Core. */
  const nativeAbandonedRef = useRef(false);
  /**
   * Live view of whether Core can still own a reroute. The DIY off-route poll reads
   * this instead of planning in parallel (see {@link resolveRerouteOwner}).
   */
  const coreRerouteHealthRef = useRef<CoreRerouteHealth>({
    active: false,
    abandoned: false,
    lastProgressAtMs: null,
    lastRouteChangedAtMs: null,
  });
  const corridorAdoptedRef = useRef(false);
  /** First Core `routeChanged` this session — later ones are mid-trip reroutes. */
  const firstRouteChangedRef = useRef(true);
  const poseHoldRef = useRef(createNativeDrivePoseHold());
  const followCamRef = useRef(createNativeDriveFollowCam());
  const listenersRef = useRef<{ remove: () => Promise<void> }[]>([]);
  const onRouteGeometryRef = useRef(onRouteGeometry);
  onRouteGeometryRef.current = onRouteGeometry;
  const onSessionEndedRef = useRef(onSessionEnded);
  onSessionEndedRef.current = onSessionEnded;
  const coordsRef = useRef(coords);
  coordsRef.current = coords;
  const prepareKeyRef = useRef("");
  const liveWindowRef = useRef<LiveTripWindow | null>(null);
  const windowStartAlongRef = useRef(0);

  const removeListeners = useCallback(async () => {
    const list = listenersRef.current;
    listenersRef.current = [];
    await Promise.all(list.map((l) => l.remove().catch(() => undefined)));
  }, []);

  const stopNative = useCallback(async () => {
    if (nativeStoppingRef.current) return;
    nativeStoppingRef.current = true;
    startedForNavRef.current = false;
    await removeListeners();
    try {
      if (isNativeMapboxNavPlatform()) {
        await StormpathMapboxNavigation.stop();
      }
    } catch {
      /* ignore */
    }
    /* Brain P2: trip ended — release the corridor pack so storage doesn't
     * pile up. Home region stays; it covers dead-zone starts near home. */
    void removeTripCorridor();
    prepareKeyRef.current = "";
    liveWindowRef.current = null;
    windowStartAlongRef.current = 0;
    setCoreWindowIsFinal(true);
    corridorAdoptedRef.current = false;
    firstRouteChangedRef.current = true;
    poseHoldRef.current.reset();
    followCamRef.current.reset();
    coreRerouteHealthRef.current = {
      active: false,
      abandoned: false,
      lastProgressAtMs: null,
      lastRouteChangedAtMs: null,
    };
    setNativeNavActive(false);
    setPosition(null);
    setFollowCamera(null);
    setGuidance(null);
    setTurnSteps([]);
    setHorizonReady(false);
    setHorizonLimit(null);
    setHorizonHazards([]);
    nativeStoppingRef.current = false;
  }, [removeListeners]);

  const prevNavStartedRef = useRef<boolean | null>(null);

  const startNative = useCallback(async () => {
    if (!isNativeMapboxNavPlatform()) return false;
    if (!accessToken) return false;
    const coordinates = buildCoordinateList(coordsRef.current);
    if (!coordinates) return false;
    const liveWindow = computeLiveTripWindow(
      coordsRef.current.lockedCorridor,
      coordsRef.current.userLngLat
    );
    liveWindowRef.current = liveWindow;
    windowStartAlongRef.current = liveWindow?.startAlongM ?? 0;
    setCoreWindowIsFinal(liveWindow?.isFinal ?? true);

    try {
      const avail = await StormpathMapboxNavigation.isAvailable();
      if (!avail.available) return false;

      await removeListeners();
      corridorAdoptedRef.current = false;
      firstRouteChangedRef.current = true;
      poseHoldRef.current.reset();
      followCamRef.current.reset();
      coreRerouteHealthRef.current = {
        active: false,
        abandoned: false,
        lastProgressAtMs: null,
        lastRouteChangedAtMs: null,
      };
      setFollowCamera(null);
      setHorizonReady(false);
      setHorizonLimit(null);
      setHorizonHazards([]);

      const handles = await Promise.all([
        StormpathMapboxNavigation.addListener("progress", (e: NativeNavProgressEvent) => {
          if (
            !shouldFeedNativeProgressToUi({
              abandoned: nativeAbandonedRef.current,
              corridorAdopted: corridorAdoptedRef.current,
            })
          ) {
            return;
          }
          bumpDriveDiag("coreSamples");
          coreRerouteHealthRef.current = {
            ...coreRerouteHealthRef.current,
            active: true,
            abandoned: nativeAbandonedRef.current,
            lastProgressAtMs: Date.now(),
          };
          const alongOnPlan =
            (windowStartAlongRef.current || 0) + (Number.isFinite(e.alongM) ? e.alongM : 0);
          const held = poseHoldRef.current.accept({
            lng: e.lng,
            lat: e.lat,
            alongM: alongOnPlan,
            headingDeg: e.headingDeg ?? null,
            speedMps: e.speedMps ?? null,
          });
          setPosition({
            positionLngLat: [held.pose.lng, held.pose.lat],
            alongM: held.pose.alongM,
            onRoute: e.onRoute,
            source: held.held || e.poseHeld ? "held" : "route_snap",
          });
          const nativeCam = parseNativeDriveFollowCamera(e);
          setFollowCamera(
            nativeCam ??
              followCamRef.current.next({
                lng: held.pose.lng,
                lat: held.pose.lat,
                headingDeg: held.pose.headingDeg,
                speedMps: held.pose.speedMps,
              })
          );
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
          if (e.horizonReady) {
            const mph = horizonLimitMph(e.horizonLimitMph);
            const hazards = horizonHazardsFromProgress(e.horizonHazards);
            setHorizonReady(true);
            setHorizonLimit((prev) => (prev === mph ? prev : mph));
            setHorizonHazards((prev) => (sameHorizonHazards(prev, hazards) ? prev : hazards));
          }
          const liveW = liveWindowRef.current;
          if (
            liveW &&
            !nativeRestartingRef.current &&
            !nativeStoppingRef.current &&
            shouldHandoffLiveTripWindow(liveW, alongOnPlan)
          ) {
            nativeRestartingRef.current = true;
            void stopNative()
              .then(() => {
                startedForNavRef.current = true;
                return startNative();
              })
              .finally(() => {
                nativeRestartingRef.current = false;
              });
          }
        }),
        StormpathMapboxNavigation.addListener("routeChanged", (e: NativeNavRouteChangedEvent) => {
          const geom = (e.geometry ?? [])
            .filter((p) => Number.isFinite(p.lng) && Number.isFinite(p.lat))
            .map((p) => [p.lng, p.lat] as LngLat);
          if (geom.length < 2) return;
          const isFirst = firstRouteChangedRef.current;
          firstRouteChangedRef.current = false;
          /* 4.20.7 submitted IPA: always force. Keep B only on the first emit. */
          const force = nativeRouteChangedShouldForce({
            isFirstRouteChanged: isFirst,
            driverAlreadyOffLockedCorridor: shouldForceAdoptOffRouteNativeGeometry({
              candidate: geom,
              locked: coordsRef.current.lockedCorridor,
              userLngLat: coordsRef.current.userLngLat,
            }),
          });
          const adopted = onRouteGeometryRef.current(geom, { force }) !== false;
          if (!adopted) {
            /* Session-start fastest steal — keep Core alive so off-route can still reroute. */
            return;
          }
          corridorAdoptedRef.current = true;
          /* Core delivered a corridor. On a mid-trip emit that *is* the reroute, so
           * the DIY poll must not also call Directions for this off-route episode. */
          if (!isFirst) {
            coreRerouteHealthRef.current = {
              ...coreRerouteHealthRef.current,
              lastRouteChangedAtMs: Date.now(),
            };
          }
          setNativeNavActive(true);
          const steps = parseNativeTurnSteps(e.turnSteps);
          if (steps.length) setTurnSteps(steps);
        }),
        StormpathMapboxNavigation.addListener("arrived", () => {
          const c = coordsRef.current;
          const w = computeLiveTripWindow(c.lockedCorridor, c.userLngLat);
          if (!isPlanDestinationArrival(c.destLngLat, c.userLngLat, w)) {
            if (nativeRestartingRef.current) return;
            nativeRestartingRef.current = true;
            void stopNative()
              .then(() => {
                startedForNavRef.current = true;
                return startNative();
              })
              .finally(() => {
                nativeRestartingRef.current = false;
              });
            return;
          }
          void stopNative().then(() => onSessionEndedRef.current?.("arrived"));
        }),
        StormpathMapboxNavigation.addListener("cancelled", () => {
          startedForNavRef.current = false;
          corridorAdoptedRef.current = false;
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
        language: guidanceLanguageRef.current,
      });
      if (!result.ok) {
        await removeListeners();
        return false;
      }
      recordMapboxUsage("navTrips");
      setNativeNavActive(true);
      /* Brain P2: kick the corridor pack download at Go so the dead-zone
       * stretch ahead already has map + nav tiles on disk. Fire-and-forget —
       * navigation starts now, the pack fills in behind it. Gated on the native
       * map shell: with it off, the native TileStore this fills renders nothing
       * (the web map's offline tiles live in IndexedDB via offlineTileCache). */
      const lockedRoute = useTripPlanStore.getState().plan.routes[0];
      if (NATIVE_DRIVE_MAP_ENABLED && accessToken && lockedRoute?.geometry?.length) {
        void downloadTripCorridor(accessToken, lockedRoute.geometry).catch(() => undefined);
      }
      return true;
    } catch (err) {
      console.warn("[nativeNav] start failed", err);
      await removeListeners();
      setNativeNavActive(false);
      return false;
    }
  }, [accessToken, removeListeners, simulate, stopNative]);

  const pendingPrepareKey = prepareRouteKey(coords, preferBackroads, guidanceLanguage);

  /** While Rt is on screen, Core plans the locked corridor so Go does not wait a second minute. */
  useEffect(() => {
    if (!isNativeMapboxNavPlatform()) return;
    if (navigationStarted || !accessToken) return;
    if (!pendingPrepareKey || prepareKeyRef.current === pendingPrepareKey) return;
    const coordinates = buildCoordinateList(coordsRef.current);
    if (!coordinates || coordinates.length < 2) return;
    const timer = window.setTimeout(() => {
      prepareKeyRef.current = pendingPrepareKey;
      void StormpathMapboxNavigation.prepareActiveGuidance({
        accessToken,
        coordinates,
        preferBackroads: preferBackroadsRef.current,
        language: guidanceLanguageRef.current,
      }).catch(() => {
        prepareKeyRef.current = "";
      });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [accessToken, navigationStarted, pendingPrepareKey]);

  /** Start Core when Go flips navigationStarted; stop when trip ends. */
  useEffect(() => {
    if (!isNativeMapboxNavPlatform()) return;

    const prevNav = prevNavStartedRef.current;
    prevNavStartedRef.current = navigationStarted;

    if (!navigationStarted) {
      nativeAbandonedRef.current = false;
      corridorAdoptedRef.current = false;
      firstRouteChangedRef.current = true;
      if (!nativeStoppingRef.current && (startedForNavRef.current || nativeNavActive)) {
        void stopNative();
      }
      return;
    }

    /* Genuine Go (false → true). Core reconnect / WebView remount must keep the trip counters
     * or About reads "0.6 s, all zeros" after a long drive. */
    if (prevNav === false) {
      resetDriveDiag();
      /* The App effect notes the lock first, then this reset wipes it. Write it
       * again or About never shows fastest vs no-interstate. */
      noteDriveDiagRouteLock(preferBackroadsRef.current, true);
    }

    if (nativeRestartingRef.current) return;
    if (startedForNavRef.current) return;
    startedForNavRef.current = true;
    void startNative().then((ok) => {
      if (!ok) {
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

  /**
   * One-press refresh. Restarts Core without ending the trip.
   * The restarting flag keeps the effect above from starting a second session.
   */
  const restartNative = useCallback(async () => {
    if (!isNativeMapboxNavPlatform()) return false;
    nativeRestartingRef.current = true;
    nativeAbandonedRef.current = false;
    try {
      await stopNative();
      startedForNavRef.current = true;
      return await startNative();
    } finally {
      nativeRestartingRef.current = false;
    }
  }, [startNative, stopNative]);

  return {
    nativeNavActive,
    position,
    followCamera,
    /** Read by the DIY off-route poll to stay out of Core's way. */
    coreRerouteHealthRef,
    /** Live Mapbox Core banner fields (instruction + distance). */
    guidance,
    /** Live Mapbox Core turn list — same route as the blue line / voice. */
    turnSteps,
    /** False while Core is only running the next ~100 mi of a longer plan. */
    coreWindowIsFinal,
    stopNative,
    restartNative,
    /** Road-graph limit once the horizon has reported. Null means it had no sign. */
    horizonMph: horizonReady ? horizonLimit : null,
    horizonHazards: horizonReady ? horizonHazards : [],
  };
}

function sameHorizonHazards(a: HorizonHazard[], b: HorizonHazard[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.kind !== b[i]!.kind || a[i]!.text !== b[i]!.text || a[i]!.distanceM !== b[i]!.distanceM) {
      return false;
    }
  }
  return true;
}
