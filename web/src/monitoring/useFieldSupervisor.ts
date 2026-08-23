import { useEffect, useRef } from "react";
import { STORMPATH_APP_VERSION, stormpathIosBuildNumber } from "../appVersion";
import { stormpathBuildFlavor } from "../config/buildFlavor";
import {
  canApplySupervisorRecovery,
  supervisorStuckMs,
} from "./fieldSupervisorLogic";
import { reportFieldSupervisorEvent } from "./appHealthSignals";
import { buildFieldReport, supervisorWatch } from "./supervisorWatchList";
import type { SupervisorWatchId } from "./supervisorWatchList";

export type UseFieldSupervisorDeps = {
  routing: boolean;
  suggestLoading: boolean;
  screen: string;
  onAbortRouting: () => void;
  onClearSearchBusy: () => void;
};

function navigatorIsOnline(): boolean {
  return typeof navigator === "undefined" ? false : navigator.onLine;
}

function emit(
  watchId: SupervisorWatchId,
  recovered: boolean,
  startedAtMs: number,
  screen: string,
  busy: { routing: boolean; suggestLoading: boolean }
): void {
  const watch = supervisorWatch(watchId);
  const online = navigatorIsOnline();
  reportFieldSupervisorEvent(
    buildFieldReport({
      watchId,
      recovered,
      recovery: watch.recover,
      online,
      navigatorOnLine: online,
      reachable: null,
      screen,
      busyFlags: { routing: busy.routing, suggestLoading: busy.suggestLoading },
      queueSizes: { mapboxUsagePending: 0, jeffPending: 0 },
      stuckMs: supervisorStuckMs(startedAtMs, Date.now()),
      appVersion: STORMPATH_APP_VERSION,
      iosBuild: stormpathIosBuildNumber(),
      buildFlavor: stormpathBuildFlavor(),
    })
  );
}

/**
 * Sync/offline supervisor — first slice: search spinner + "Building routes…" hangs.
 * Other watches in supervisorWatchList.ts are not polled yet.
 */
export function useFieldSupervisor(deps: UseFieldSupervisorDeps): void {
  const { routing, suggestLoading, screen, onAbortRouting, onClearSearchBusy } = deps;
  const lastRoutingRepairAtRef = useRef<number | null>(null);
  const lastSearchRepairAtRef = useRef<number | null>(null);
  const routingStartedAtRef = useRef<number | null>(null);
  const searchStartedAtRef = useRef<number | null>(null);
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const onAbortRoutingRef = useRef(onAbortRouting);
  onAbortRoutingRef.current = onAbortRouting;
  const onClearSearchBusyRef = useRef(onClearSearchBusy);
  onClearSearchBusyRef.current = onClearSearchBusy;

  useEffect(() => {
    if (!routing) {
      routingStartedAtRef.current = null;
      return;
    }
    const startedAt = Date.now();
    routingStartedAtRef.current = startedAt;
    const maxMs = supervisorWatch("routing_hang").maxMs;
    const t = window.setTimeout(() => {
      const now = Date.now();
      if (!canApplySupervisorRecovery(lastRoutingRepairAtRef.current, now)) return;
      lastRoutingRepairAtRef.current = now;
      onAbortRoutingRef.current();
      emit("routing_hang", true, startedAt, screenRef.current, {
        routing: false,
        suggestLoading: false,
      });
    }, maxMs);
    return () => window.clearTimeout(t);
  }, [routing]);

  useEffect(() => {
    if (!suggestLoading) {
      searchStartedAtRef.current = null;
      return;
    }
    const startedAt = Date.now();
    searchStartedAtRef.current = startedAt;
    const maxMs = supervisorWatch("search_hang").maxMs;
    const t = window.setTimeout(() => {
      const now = Date.now();
      if (!canApplySupervisorRecovery(lastSearchRepairAtRef.current, now)) return;
      lastSearchRepairAtRef.current = now;
      onClearSearchBusyRef.current();
      emit("search_hang", true, startedAt, screenRef.current, {
        routing: false,
        suggestLoading: false,
      });
    }, maxMs);
    return () => window.clearTimeout(t);
  }, [suggestLoading]);
}
