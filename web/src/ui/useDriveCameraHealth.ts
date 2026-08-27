import { useEffect, useRef, type MutableRefObject } from "react";
import type { LngLat } from "../nav/types";
import { resolveTravelBearingDeg } from "./mapDriveCamera";
import {
  auditDriveCameraHeading,
  repairActionsForDriveCameraIssues,
  DRIVE_CAMERA_HEADING_STUCK_CONFIRM_TICKS,
} from "./driveCameraHealth";
import {
  auditDrivePuckPlacement,
  repairActionsForDrivePuckIssues,
  DRIVE_PUCK_ANCHOR_STUCK_CONFIRM_TICKS,
} from "./drivePuckHealth";
import { reportAppHealthRepair } from "../monitoring/appHealthSignals";
import { resolveJeffSupervisorRecovery } from "../monitoring/jeffSupervisor";
import { reportJeffSighting, noteForJeffDomain } from "./jeffTheBot";

/** Puck drift needs a snappier poll — on a frozen map the puck climbs the route fast. */
const POLL_MS = 1_500;
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
  /** Last course-over-ground held by DriveMap — fills GPS gaps where this poll's fixes are too short. */
  lastTravelBearingDegRef?: MutableRefObject<number | null>;
  /** Pixel drift of the puck from the fixed drive yard-line anchor (null = not measuring). */
  puckAnchorDriftPxRef?: MutableRefObject<number | null>;
  /** Bump the follow-cam resync key — re-centers the map on the puck and snaps bearing. */
  onResyncCamera: () => void;
  /** Supervisor dead-zone hold — skip automatic jumpTo resync; keep last camera. */
  holdLastGoodMap?: boolean;
};

/**
 * Background watchdog + self-heal for drive follow-cam: while GO is active in drive view,
 * periodically checks (1) applied camera bearing vs course-over-ground and (2) puck screen
 * position vs the fixed yard-line anchor. Either failure forces the same follow-cam resync
 * and lights up Jeff so the fix isn't invisible. Jeff reports to the supervisor:
 * dead-zone hold skips the yank; a healthy link still resyncs.
 */
export function useDriveCameraHealth(deps: UseDriveCameraHealthDeps): void {
  const {
    navigationStarted,
    viewMode,
    appForeground,
    userLngLatRef,
    speedMpsRef,
    cameraBearingDegRef,
    lastTravelBearingDegRef,
    puckAnchorDriftPxRef,
    onResyncCamera,
    holdLastGoodMap = false,
  } = deps;

  const prevFixRef = useRef<{ lng: number; lat: number } | null>(null);
  const curFixRef = useRef<{ lng: number; lat: number } | null>(null);
  const headingBadStreakRef = useRef(0);
  const puckBadStreakRef = useRef(0);
  const lastRepairAtRef = useRef(0);

  useEffect(() => {
    const active = navigationStarted && viewMode === "drive" && appForeground;
    if (!active) {
      prevFixRef.current = null;
      curFixRef.current = null;
      headingBadStreakRef.current = 0;
      puckBadStreakRef.current = 0;
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

      const liveTravel = resolveTravelBearingDeg({
        headingDeg: null,
        prevFix: prevFixRef.current,
        curFix: curFixRef.current,
        speedMps: speedMpsRef.current,
        /* Match the follow-cam motion floor so Jeff sees the same COG DriveMap trusts. */
        minMotionBearingM: 6,
      });
      const held = lastTravelBearingDegRef?.current;
      const travelBearingDeg =
        liveTravel ?? (held != null && Number.isFinite(held) ? held : null);

      const headingAudit = auditDriveCameraHeading({
        travelBearingDeg,
        appliedCameraBearingDeg: cameraBearingDegRef.current,
        speedMps: speedMpsRef.current,
      });
      if (headingAudit.ok) headingBadStreakRef.current = 0;
      else headingBadStreakRef.current += 1;

      const puckAudit = auditDrivePuckPlacement({
        driftPx: puckAnchorDriftPxRef?.current ?? null,
        speedMps: speedMpsRef.current,
      });
      if (puckAudit.ok) puckBadStreakRef.current = 0;
      else puckBadStreakRef.current += 1;

      const headingReady =
        !headingAudit.ok &&
        headingBadStreakRef.current >= DRIVE_CAMERA_HEADING_STUCK_CONFIRM_TICKS;
      const puckReady =
        !puckAudit.ok &&
        (puckAudit.severe ||
          puckBadStreakRef.current >= DRIVE_PUCK_ANCHOR_STUCK_CONFIRM_TICKS);
      if (!headingReady && !puckReady) return;
      const jeffDomain = puckReady ? "drive_puck" : "drive_camera";
      const recovery = resolveJeffSupervisorRecovery({
        holdLastGoodMap,
        domain: jeffDomain,
      });
      if (recovery === "hold_last_good_map") {
        headingBadStreakRef.current = 0;
        puckBadStreakRef.current = 0;
        return;
      }

      const now = Date.now();
      if (now - lastRepairAtRef.current < REPAIR_COOLDOWN_MS) return;
      lastRepairAtRef.current = now;
      headingBadStreakRef.current = 0;
      puckBadStreakRef.current = 0;

      /* Prefer the more specific puck note when that's what fired; otherwise camera. */
      if (puckReady) {
        const actions = repairActionsForDrivePuckIssues(puckAudit.issues);
        if (recovery === "resync_camera" && actions.includes("resync_camera")) onResyncCamera();
        reportAppHealthRepair("drive_puck", puckAudit.issues, actions);
        reportJeffSighting("drive_puck", noteForJeffDomain("drive_puck"));
        if (import.meta.env.DEV) {
          console.info("[drive-puck-health] resyncing follow-cam —", puckAudit.issues);
        }
        return;
      }

      const actions = repairActionsForDriveCameraIssues(headingAudit.issues);
      if (recovery === "resync_camera" && actions.includes("resync_camera")) onResyncCamera();
      reportAppHealthRepair("drive_camera", headingAudit.issues, actions);
      reportJeffSighting("drive_camera", noteForJeffDomain("drive_camera"));
      if (import.meta.env.DEV) {
        console.info("[drive-camera-health] resyncing camera —", headingAudit.issues);
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
    lastTravelBearingDegRef,
    puckAnchorDriftPxRef,
    onResyncCamera,
    holdLastGoodMap,
  ]);
}
