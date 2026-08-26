import { useEffect, useRef, useState } from "react";
import { STORMPATH_APP_VERSION, stormpathIosBuildNumber } from "../appVersion";
import { stormpathBuildFlavor } from "../config/buildFlavor";
import { reportFieldSupervisorEvent } from "./appHealthSignals";
import {
  SUPERVISOR_REPEAT_WINDOW_MS,
  canApplySupervisorRecovery,
  shouldReportSupervisorWatch,
  supervisorStuckMs,
} from "./fieldSupervisorLogic";
import {
  probeMapReachability,
  readNativeNetworkConnected,
} from "./mapReachabilityProbe";
import { NETWORK_RECONNECT_POLL_MS } from "./networkConnectivity";
import { buildFieldReport, supervisorWatch } from "./supervisorWatchList";
import type { SupervisorBusyFlag, SupervisorWatchId } from "./supervisorWatchList";

export type UseFieldSupervisorDeps = {
  routing: boolean;
  suggestLoading: boolean;
  bypassBusy: boolean;
  trafficFetchDone: boolean;
  trafficWatchEligible: boolean;
  stormLoading: boolean;
  stormCorridorEmpty: boolean;
  navigationStarted: boolean;
  isOnline: boolean;
  screen: string;
  onAbortRouting: () => void;
  onClearSearchBusy: () => void;
  onClearBypassBusy: () => void;
  onMarkTrafficFetchDone: () => void;
  onClearStormLoading: () => void;
};

export type FieldSupervisorState = {
  /** Last-good tiles / camera / road snap — skip Jeff jump and basemap reload. */
  holdLastGoodMap: boolean;
  reachable: boolean | null;
};

type BusySnapshot = Partial<Record<SupervisorBusyFlag, boolean>>;

function navigatorIsOnline(): boolean {
  return typeof navigator === "undefined" ? false : navigator.onLine;
}

/**
 * Phone supervisor. Primary job: keep the map moving on last-good tiles in a
 * dead zone. Also unsticks hung search / routing / bypass / traffic / storm
 * busy flags so a weak cell does not freeze the UI.
 */
export function useFieldSupervisor(deps: UseFieldSupervisorDeps): FieldSupervisorState {
  const {
    routing,
    suggestLoading,
    bypassBusy,
    trafficFetchDone,
    trafficWatchEligible,
    stormLoading,
    stormCorridorEmpty,
    navigationStarted,
    isOnline,
    screen,
    onAbortRouting,
    onClearSearchBusy,
    onClearBypassBusy,
    onMarkTrafficFetchDone,
    onClearStormLoading,
  } = deps;

  const [reachable, setReachable] = useState<boolean | null>(null);
  const [holdLastGoodMap, setHoldLastGoodMap] = useState(false);

  const screenRef = useRef(screen);
  screenRef.current = screen;
  const reachableRef = useRef(reachable);
  reachableRef.current = reachable;
  const holdRef = useRef(holdLastGoodMap);
  holdRef.current = holdLastGoodMap;
  const lastHoldClearedAtRef = useRef<number | null>(null);
  const lastMapReportAtRef = useRef<number | null>(null);

  const onAbortRoutingRef = useRef(onAbortRouting);
  onAbortRoutingRef.current = onAbortRouting;
  const onClearSearchBusyRef = useRef(onClearSearchBusy);
  onClearSearchBusyRef.current = onClearSearchBusy;
  const onClearBypassBusyRef = useRef(onClearBypassBusy);
  onClearBypassBusyRef.current = onClearBypassBusy;
  const onMarkTrafficFetchDoneRef = useRef(onMarkTrafficFetchDone);
  onMarkTrafficFetchDoneRef.current = onMarkTrafficFetchDone;
  const onClearStormLoadingRef = useRef(onClearStormLoading);
  onClearStormLoadingRef.current = onClearStormLoading;

  const emit = (
    watchId: SupervisorWatchId,
    recovered: boolean,
    startedAtMs: number,
    busy: BusySnapshot
  ) => {
    const watch = supervisorWatch(watchId);
    const online = navigatorIsOnline();
    reportFieldSupervisorEvent(
      buildFieldReport({
        watchId,
        recovered,
        recovery: watch.recover,
        online,
        navigatorOnLine: online,
        reachable: reachableRef.current,
        screen: screenRef.current,
        busyFlags: busy,
        queueSizes: { mapboxUsagePending: 0, jeffPending: 0 },
        stuckMs: supervisorStuckMs(startedAtMs, Date.now()),
        appVersion: STORMPATH_APP_VERSION,
        iosBuild: stormpathIosBuildNumber(),
        buildFlavor: stormpathBuildFlavor(),
      })
    );
  };

  const applyHold = (watchId: "map_low_signal" | "false_online", startedAtMs: number) => {
    const wasHold = holdRef.current;
    setReachable(false);
    setHoldLastGoodMap(true);
    if (wasHold) return;
    const now = Date.now();
    const isRepeat =
      lastHoldClearedAtRef.current != null &&
      now - lastHoldClearedAtRef.current < SUPERVISOR_REPEAT_WINDOW_MS;
    const watch = supervisorWatch(watchId);
    if (!shouldReportSupervisorWatch(watch.reportWhen, isRepeat)) return;
    if (!canApplySupervisorRecovery(lastMapReportAtRef.current, now)) return;
    lastMapReportAtRef.current = now;
    emit(watchId, true, startedAtMs, { routing: false, suggestLoading: false });
  };

  const clearHold = () => {
    if (holdRef.current) lastHoldClearedAtRef.current = Date.now();
    setReachable(true);
    setHoldLastGoodMap(false);
  };

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (!isOnline) {
        applyHold("map_low_signal", Date.now());
        return;
      }
      const startedAt = Date.now();
      const native = await readNativeNetworkConnected();
      if (cancelled) return;
      /* Native false while isOnline is still true = Wi‑Fi→cell grace. Do not hold yet. */
      if (native === false) return;
      const ok = await probeMapReachability({ navigatorOnLine: true });
      if (cancelled) return;
      if (ok) {
        clearHold();
        return;
      }
      /* Probe fails on a locked-down desktop too — only hold while GO (or already holding). */
      if (navigationStarted || holdRef.current) {
        applyHold("false_online", startedAt);
      }
    };

    void tick();
    const id = window.setInterval(() => {
      if (!isOnline || navigationStarted || holdRef.current) void tick();
    }, NETWORK_RECONNECT_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
    // applyHold / clearHold close over latest refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline, navigationStarted]);

  useStuckWatch({
    active: routing,
    watchId: "routing_hang",
    recover: () => onAbortRoutingRef.current(),
    emit,
    busy: () => ({ routing: false, suggestLoading: false }),
  });

  useStuckWatch({
    active: suggestLoading,
    watchId: "search_hang",
    recover: () => onClearSearchBusyRef.current(),
    emit,
    busy: () => ({ routing: false, suggestLoading: false }),
  });

  useStuckWatch({
    active: bypassBusy,
    watchId: "bypass_hang",
    recover: () => onClearBypassBusyRef.current(),
    emit,
    busy: () => ({ bypassBusy: false }),
  });

  useStuckWatch({
    active: trafficWatchEligible && !trafficFetchDone,
    watchId: "traffic_overlay_stuck",
    recover: () => onMarkTrafficFetchDoneRef.current(),
    emit,
    busy: () => ({ trafficFetchDone: true }),
  });

  useStuckWatch({
    active: stormLoading && stormCorridorEmpty,
    watchId: "storm_alerts_hang",
    recover: () => onClearStormLoadingRef.current(),
    emit,
    busy: () => ({ stormLoading: false }),
  });

  return { holdLastGoodMap, reachable };
}

function useStuckWatch(opts: {
  active: boolean;
  watchId: SupervisorWatchId;
  recover: () => void;
  emit: (watchId: SupervisorWatchId, recovered: boolean, startedAtMs: number, busy: BusySnapshot) => void;
  busy: () => BusySnapshot;
}): void {
  const lastRepairAtRef = useRef<number | null>(null);
  const recoverRef = useRef(opts.recover);
  recoverRef.current = opts.recover;
  const emitRef = useRef(opts.emit);
  emitRef.current = opts.emit;
  const busyRef = useRef(opts.busy);
  busyRef.current = opts.busy;

  useEffect(() => {
    if (!opts.active) return;
    const startedAt = Date.now();
    const watch = supervisorWatch(opts.watchId);
    const t = window.setTimeout(() => {
      const now = Date.now();
      if (!canApplySupervisorRecovery(lastRepairAtRef.current, now)) return;
      lastRepairAtRef.current = now;
      recoverRef.current();
      if (shouldReportSupervisorWatch(watch.reportWhen, false)) {
        emitRef.current(opts.watchId, true, startedAt, busyRef.current());
      }
    }, watch.maxMs);
    return () => window.clearTimeout(t);
  }, [opts.active, opts.watchId]);
}
