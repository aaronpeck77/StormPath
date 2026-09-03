import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { haversineMeters } from "../nav/routeGeometry";
import {
  isDriveLoopStalled,
  isOffRouteSubsystemHung,
} from "../nav/driveSubsystemHealth";
import type { LngLat } from "../nav/types";

export type OffRouteSample = { t: number; lateralM: number; alongM: number };

/**
 * Live flags for the phone supervisor: Drive loop stall (GPS moved, along frozen)
 * and off-route subsystem hang (stuck reroute or silent poll).
 */
export function useDriveSubsystemFlags(opts: {
  navigationStarted: boolean;
  offRouteLatched: boolean;
  userLngLatRef: MutableRefObject<LngLat | null>;
  userAlongMRef: MutableRefObject<number>;
  lastOffRouteSampleRef: MutableRefObject<OffRouteSample | null>;
  rerouteInFlightRef: MutableRefObject<boolean>;
}): { driveStallActive: boolean; offRouteHangActive: boolean } {
  const {
    navigationStarted,
    offRouteLatched,
    userLngLatRef,
    userAlongMRef,
    lastOffRouteSampleRef,
    rerouteInFlightRef,
  } = opts;

  const [driveStallActive, setDriveStallActive] = useState(false);
  const [offRouteHangActive, setOffRouteHangActive] = useState(false);
  const windowRef = useRef<{
    gps: LngLat | null;
    along: number;
    atMs: number;
    inFlightSinceMs: number | null;
    latchedSinceMs: number | null;
  }>({ gps: null, along: 0, atMs: 0, inFlightSinceMs: null, latchedSinceMs: null });

  useEffect(() => {
    if (!navigationStarted) {
      setDriveStallActive(false);
      setOffRouteHangActive(false);
      windowRef.current = {
        gps: userLngLatRef.current,
        along: userAlongMRef.current,
        atMs: Date.now(),
        inFlightSinceMs: null,
        latchedSinceMs: null,
      };
      return;
    }

    windowRef.current = {
      gps: userLngLatRef.current,
      along: userAlongMRef.current,
      atMs: Date.now(),
      inFlightSinceMs: rerouteInFlightRef.current ? Date.now() : null,
      latchedSinceMs: offRouteLatched ? Date.now() : null,
    };

    const tick = () => {
      const now = Date.now();
      const w = windowRef.current;
      if (rerouteInFlightRef.current) {
        if (w.inFlightSinceMs == null) w.inFlightSinceMs = now;
      } else {
        w.inFlightSinceMs = null;
      }
      if (offRouteLatched) {
        if (w.latchedSinceMs == null) w.latchedSinceMs = now;
      } else {
        w.latchedSinceMs = null;
      }

      const gps = userLngLatRef.current;
      const along = userAlongMRef.current;
      const gpsMovedM =
        w.gps && gps ? haversineMeters(w.gps, gps) : 0;
      const alongMovedM = Math.abs(along - w.along);
      const windowMs = now - w.atMs;

      setDriveStallActive(
        isDriveLoopStalled({
          navigationStarted: true,
          windowMs,
          gpsMovedM,
          alongMovedM,
          offRouteLatched,
        })
      );

      const sample = lastOffRouteSampleRef.current;
      const lastSampleAgeMs = sample
        ? now - sample.t
        : w.latchedSinceMs != null
          ? now - w.latchedSinceMs
          : null;
      setOffRouteHangActive(
        isOffRouteSubsystemHung({
          navigationStarted: true,
          offRouteLatched,
          rerouteInFlightMs: w.inFlightSinceMs != null ? now - w.inFlightSinceMs : null,
          lastSampleAgeMs,
        })
      );

      if (windowMs >= 8_000) {
        w.gps = gps;
        w.along = along;
        w.atMs = now;
      }
    };

    tick();
    const id = window.setInterval(tick, 2_000);
    return () => window.clearInterval(id);
  }, [
    navigationStarted,
    offRouteLatched,
    userLngLatRef,
    userAlongMRef,
    lastOffRouteSampleRef,
    rerouteInFlightRef,
  ]);

  return { driveStallActive, offRouteHangActive };
}
