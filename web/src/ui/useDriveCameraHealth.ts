import { useEffect, useRef, type MutableRefObject } from "react";
import type { LngLat } from "../nav/types";
import { resolveTravelBearingDeg } from "./mapDriveCamera";
import {
  auditDriveCameraHeading,
  repairActionsForDriveCameraIssues,
  DRIVE_CAMERA_HEADING_STUCK_CONFIRM_TICKS,
} from "./driveCameraHealth";
import { reportAppHealthRepair } from "../monitoring/appHealthSignals";
import { reportJeffSighting, noteForJeffDomain } from "./jeffTheBot";

const POLL_MS = 3_000;
/** Minimum spacing between automatic camera resyncs — avoid fighting a real GPS-noise blip. */
const REPAIR_COOLDOWN_MS = 15_000;

export type UseDriveCameraHealthDeps = {
  navigationStarted: boolean;
  viewMode: string;
  appForeground: boolean;
  userLngLatRef: MutableRefObject<LngLat | null>;
  speedMpsRef: MutableRefObject<number | null>;
  /** Live camera bearing actually applied to the map (reported from DriveMap's follow-cam loop). */
  cameraBearingDegRef: MutableRefObject<number | null>;
  /** Bump the follow-cam resync key — clears the bearing smoother and hard-snaps the camera. */
  onResyncCamera: () => void;
};

/**
 * Background watchdog + self-heal for the drive follow-cam: while GO is active in drive view,
 * periodically checks the applied camera bearing against ground-truth course-over-ground.
 * If they disagree for a couple of consecutive polls at real driving speed, forces a camera
 * resync (same repair already used for foreground-resume / sheet-close desyncs) and reports
 * the anomaly so we know it happened even without the driver mentioning it.
 */
export function useDriveCameraHealth(deps: UseDriveCameraHealthDeps): void {
  const {
    navigationStarted,
    viewMode,
    appForeground,
    userLngLatRef,
    speedMpsRef,
    cameraBearingDegRef,
    onResyncCamera,
  } = deps;

  const prevFixRef = useRef<{ lng: number; lat: number } | null>(null);
  const curFixRef = useRef<{ lng: number; lat: number } | null>(null);
  const badStreakRef = useRef(0);
  const lastRepairAtRef = useRef(0);

  useEffect(() => {
    const active = navigationStarted && viewMode === "drive" && appForeground;
    if (!active) {
      prevFixRef.current = null;
      curFixRef.current = null;
      badStreakRef.current = 0;
      return;
    }

    const tick = () => {
      const pos = userLngLatRef.current;
      if (pos) {
        const fix = { lng: pos[0], lat: pos[1] };
        const cur = curFixRef.current;
        if (!cur || cur.lng !== fix.lng || cur.lat !== fix.lat) {
          prevFixRef.current = cur;
          curFixRef.current = fix;
        }
      }

      const travelBearingDeg = resolveTravelBearingDeg({
        headingDeg: null,
        prevFix: prevFixRef.current,
        curFix: curFixRef.current,
        speedMps: speedMpsRef.current,
        minMotionBearingM: 10,
      });

      const audit = auditDriveCameraHeading({
        travelBearingDeg,
        appliedCameraBearingDeg: cameraBearingDegRef.current,
        speedMps: speedMpsRef.current,
      });

      if (audit.ok) {
        badStreakRef.current = 0;
        return;
      }
      badStreakRef.current += 1;
      if (badStreakRef.current < DRIVE_CAMERA_HEADING_STUCK_CONFIRM_TICKS) return;

      const now = Date.now();
      if (now - lastRepairAtRef.current < REPAIR_COOLDOWN_MS) return;
      lastRepairAtRef.current = now;
      badStreakRef.current = 0;

      const actions = repairActionsForDriveCameraIssues(audit.issues);
      if (actions.includes("resync_camera")) onResyncCamera();
      reportAppHealthRepair("drive_camera", audit.issues, actions);
      reportJeffSighting("drive_camera", noteForJeffDomain("drive_camera"));
      if (import.meta.env.DEV) {
        console.info("[drive-camera-health] resyncing camera —", audit.issues);
      }
    };

    tick();
    const id = window.setInterval(tick, POLL_MS);
    return () => window.clearInterval(id);
  }, [
    navigationStarted,
    viewMode,
    appForeground,
    userLngLatRef,
    speedMpsRef,
    cameraBearingDegRef,
    onResyncCamera,
  ]);
}
