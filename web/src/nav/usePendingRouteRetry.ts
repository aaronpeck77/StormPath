import { useEffect, useRef } from "react";
import { usePendingRouteStore } from "../state/pendingRouteStore";
import type { ComputeRoutesFn } from "./useComputeRoutes";

/** Grace period after connectivity returns before replaying the queued request. */
const RETRY_DELAY_MS = 1_500;
/** Weak-signal cadence: the radio says online but fetches still fail — keep trying. */
const RETRY_INTERVAL_MS = 30_000;
const READY_HINT_MS = 6_000;

/**
 * Replays a queued route/search once a usable data connection returns.
 *
 * - Fires 1.5 s after `isOnline` flips true (also on mount when a persisted pending
 *   request is restored while already online), then every 30 s while the request is
 *   still queued and the device reports online.
 * - Route retry: `computeRoutes` re-queues itself on another no-connection failure
 *   (silent `{ ok: false, reason: "" }`), so pending simply stays. On success the
 *   store is already cleared by `useComputeRoutes`; we show "Route ready — tap Go".
 *   Any other failure clears the queue so the normal routeError stands alone.
 * - Search retry: the queue entry is dropped first — `handleSearch` re-queues itself
 *   if the connection is still down, plans the route on a single hit, or shows the
 *   normal pick list on multiple hits.
 * - If navigation starts, the queue is dropped — the driver moved on.
 */
export function usePendingRouteRetry(deps: {
  isOnline: boolean;
  navigationStarted: boolean;
  computeRoutes: ComputeRoutesFn;
  runSearch: (query: string) => Promise<unknown>;
  setTapHint: (msg: string | null) => void;
}): void {
  const { isOnline, navigationStarted } = deps;
  const pending = usePendingRouteStore((s) => s.pending);
  /* Latest deps via ref so the retry timers don't restart when callbacks re-identify. */
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const inFlightRef = useRef(false);
  const hintTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (navigationStarted) usePendingRouteStore.getState().clearPending();
  }, [navigationStarted]);

  /* Keyed on a boolean, not the pending object: a re-queued request (new createdAt)
   * must not reset the 1.5 s delay into a tight retry loop. */
  const retryActive = pending != null && isOnline && !navigationStarted;

  useEffect(() => {
    if (!retryActive) return;
    let stopped = false;
    let delayTimer: number | null = null;
    let intervalTimer: number | null = null;

    const attempt = () => {
      const p = usePendingRouteStore.getState().pending;
      if (!p || stopped || inFlightRef.current) return;
      inFlightRef.current = true;
      void (async () => {
        try {
          if (p.kind === "route") {
            const res = await depsRef.current.computeRoutes(p.end, p.label);
            if (res.ok) {
              depsRef.current.setTapHint("Route ready — tap Go");
              if (hintTimerRef.current != null) window.clearTimeout(hintTimerRef.current);
              hintTimerRef.current = window.setTimeout(() => {
                hintTimerRef.current = null;
                depsRef.current.setTapHint(null);
              }, READY_HINT_MS);
            } else if (
              res.reason !== "" &&
              usePendingRouteStore.getState().pending === p
            ) {
              /* Real routing failure (not a silent no-connection re-queue): drop the
               * entry so the routeError computeRoutes surfaced stands alone. */
              usePendingRouteStore.getState().clearPending();
            }
          } else {
            if (usePendingRouteStore.getState().pending === p) {
              usePendingRouteStore.getState().clearPending();
            }
            await depsRef.current.runSearch(p.query);
          }
        } catch {
          /* Whatever computeRoutes/handleSearch already queued or surfaced stands. */
        } finally {
          inFlightRef.current = false;
        }
      })();
    };

    delayTimer = window.setTimeout(() => {
      attempt();
      intervalTimer = window.setInterval(attempt, RETRY_INTERVAL_MS);
    }, RETRY_DELAY_MS);

    return () => {
      stopped = true;
      if (delayTimer != null) window.clearTimeout(delayTimer);
      if (intervalTimer != null) window.clearInterval(intervalTimer);
    };
  }, [retryActive]);

  /* Success clears pending → retryActive flips false; the "Route ready" hint timer
   * must outlive that, so it is only cancelled on unmount. */
  useEffect(
    () => () => {
      if (hintTimerRef.current != null) window.clearTimeout(hintTimerRef.current);
    },
    []
  );
}
