/**
 * Field-resilience supervisor — watch list, allowed recoveries, and the report
 * payload a phone can emit to Sentry / webhook.
 *
 * Phone job (what the driver actually feels): hold last-good map / camera /
 * road snap in a dead zone (`map_low_signal`). Search + routing hang
 * recoveries stay as cheap backups.
 *
 * See `docs/FIELD_RESILIENCE_SUPERVISOR.md`.
 */

/** Busy flags already surfaced in `useDebouncedBusyLabel` / App. */
export type SupervisorBusyFlag =
  | "routing"
  | "bypassBusy"
  | "suggestLoading"
  | "trafficFetchDone"
  | "stormLoading";

export type SupervisorWatchId =
  | "map_low_signal"
  | "jeff_drive_camera"
  | "jeff_drive_puck"
  | "jeff_live_traffic"
  | "routing_hang"
  | "search_hang"
  | "bypass_hang"
  | "traffic_overlay_stuck"
  | "storm_alerts_hang"
  | "false_online"
  | "ops_pending_flush"
  | "trip_cache_stale"
  | "go_without_geometry"
  | "weatherkit_token_hang";

/** Deterministic actions the phone is allowed to take. Never invent new ones on device. */
export type SupervisorRecovery =
  | "hold_last_good_map"
  | "resync_camera"
  | "refresh_traffic"
  | "abort_and_clear_busy"
  | "keep_last_good_and_clear_busy"
  | "skip_fetch_until_online"
  | "flush_ops_pending"
  | "restore_trip_from_idb"
  | "end_nav_to_plan"
  | "probe_reachability"
  | "report_only";

export type SupervisorWatch = {
  id: SupervisorWatchId;
  /** What we look at (code path / flag). */
  signal: string;
  /** Treat as stuck after this many ms. */
  maxMs: number;
  /** First recovery to try. */
  recover: SupervisorRecovery;
  /** Escalate to Sentry / webhook if recovery is not enough or this fires N times. */
  reportWhen: "always_after_recovery" | "if_still_stuck" | "if_repeated";
};

/**
 * Ordered watch list. Earlier rows win if two fire in the same tick
 * (routing hang before search hang, etc.).
 */
export const SUPERVISOR_WATCHES: readonly SupervisorWatch[] = [
  {
    id: "map_low_signal",
    signal: "offline, Capacitor Network down, or Mapbox probe fail while tiles/camera should hold",
    maxMs: 4_000,
    recover: "hold_last_good_map",
    reportWhen: "if_repeated",
  },
  {
    id: "jeff_drive_camera",
    signal: "Jeff: applied follow-cam bearing vs course-over-ground (useDriveCameraHealth)",
    maxMs: 3_000,
    recover: "resync_camera",
    reportWhen: "if_repeated",
  },
  {
    id: "jeff_drive_puck",
    signal: "Jeff: puck pixel drift from yard-line anchor (useDriveCameraHealth)",
    maxMs: 3_000,
    recover: "resync_camera",
    reportWhen: "if_repeated",
  },
  {
    id: "jeff_live_traffic",
    signal: "Jeff: live Mapbox traffic overlay stale while driving (useLiveTrafficHealth)",
    maxMs: 30_000,
    recover: "refresh_traffic",
    reportWhen: "if_repeated",
  },
  {
    id: "routing_hang",
    signal: "App routing=true via useComputeRoutes / Mapbox Directions (55s timeout)",
    maxMs: 20_000,
    recover: "abort_and_clear_busy",
    reportWhen: "always_after_recovery",
  },
  {
    id: "search_hang",
    signal: "suggestLoading=true in useDestinationSearch (autocomplete has no .catch)",
    maxMs: 12_000,
    recover: "abort_and_clear_busy",
    reportWhen: "always_after_recovery",
  },
  {
    id: "bypass_hang",
    signal: "bypassBusy=true in traffic-bypass / route-compare",
    maxMs: 20_000,
    recover: "abort_and_clear_busy",
    reportWhen: "always_after_recovery",
  },
  {
    id: "traffic_overlay_stuck",
    signal: "trafficFetchDone=false while navigating + traffic on + navigator.onLine",
    maxMs: 40_000,
    recover: "keep_last_good_and_clear_busy",
    reportWhen: "if_repeated",
  },
  {
    id: "storm_alerts_hang",
    signal: "stormLoading=true with empty NWS corridor (StormAdvisoryBar 12s slow warn)",
    maxMs: 18_000,
    recover: "keep_last_good_and_clear_busy",
    reportWhen: "if_still_stuck",
  },
  {
    id: "false_online",
    signal: "navigator.onLine or native radio looks up but Mapbox probe fails (cell dead zone)",
    maxMs: 8_000,
    recover: "skip_fetch_until_online",
    reportWhen: "if_repeated",
  },
  {
    id: "ops_pending_flush",
    signal: "stormpath.mapboxUsage.pending.v1 (and unused jeff pending) while online",
    maxMs: 45_000,
    recover: "flush_ops_pending",
    reportWhen: "if_still_stuck",
  },
  {
    id: "trip_cache_stale",
    signal: "IndexedDB tripCache last save > interval while an active trip exists",
    maxMs: 45_000,
    recover: "restore_trip_from_idb",
    reportWhen: "if_still_stuck",
  },
  {
    id: "go_without_geometry",
    signal: "navigationStarted with no route geometry / no GPS fix",
    maxMs: 15_000,
    recover: "end_nav_to_plan",
    reportWhen: "always_after_recovery",
  },
  {
    id: "weatherkit_token_hang",
    signal: "weatherKitAuth fetch with no wall-clock timeout",
    maxMs: 12_000,
    recover: "abort_and_clear_busy",
    reportWhen: "if_repeated",
  },
];

export const SUPERVISOR_WATCH_IDS: readonly SupervisorWatchId[] =
  SUPERVISOR_WATCHES.map((w) => w.id);

/** Watches the phone actually polls. The rest of the table stays as a contract. */
export const SUPERVISOR_PHONE_WATCH_IDS: readonly SupervisorWatchId[] = [
  "map_low_signal",
  "false_online",
  "jeff_drive_camera",
  "jeff_drive_puck",
  "jeff_live_traffic",
  "routing_hang",
  "search_hang",
  "bypass_hang",
  "traffic_overlay_stuck",
  "storm_alerts_hang",
];

export const JEFF_SUPERVISOR_WATCH_IDS: readonly SupervisorWatchId[] = [
  "jeff_drive_camera",
  "jeff_drive_puck",
  "jeff_live_traffic",
];

const WATCH_BY_ID = new Map(SUPERVISOR_WATCHES.map((w) => [w.id, w]));

export function supervisorWatch(id: SupervisorWatchId): SupervisorWatch {
  const w = WATCH_BY_ID.get(id);
  if (!w) throw new Error(`unknown supervisor watch: ${id}`);
  return w;
}

export function isSupervisorWatchId(id: string): id is SupervisorWatchId {
  return WATCH_BY_ID.has(id as SupervisorWatchId);
}

export function isAllowedRecovery(
  id: SupervisorWatchId,
  recovery: SupervisorRecovery
): boolean {
  const w = WATCH_BY_ID.get(id);
  if (!w) return false;
  if (recovery === w.recover || recovery === "report_only") return true;
  /* Dead-zone hold is always allowed to override Jeff's normal yank/refresh. */
  return recovery === "hold_last_good_map" && JEFF_SUPERVISOR_WATCH_IDS.includes(id);
}

/** Payload phones send to Sentry extras / webhook after a supervisor event. */
export type FieldSupervisorReport = {
  schema: "stormpath.field_supervisor.v1";
  watchId: SupervisorWatchId;
  recovered: boolean;
  recovery: SupervisorRecovery;
  online: boolean;
  /** navigator.onLine — often wrong in dead zones; probe result is `reachable`. */
  navigatorOnLine: boolean;
  reachable: boolean | null;
  screen: string;
  busyFlags: Partial<Record<SupervisorBusyFlag, boolean>>;
  queueSizes: {
    mapboxUsagePending: number;
    jeffPending: number;
  };
  stuckMs: number;
  appVersion: string;
  iosBuild: string | null;
  buildFlavor: string;
  note?: string;
};

export function sentryHealthMessage(watchId: SupervisorWatchId): string {
  return `stormpath.health.supervisor.${watchId}`;
}

export function buildFieldReport(
  partial: Omit<FieldSupervisorReport, "schema">
): FieldSupervisorReport {
  return { schema: "stormpath.field_supervisor.v1", ...partial };
}

export function isFieldSupervisorReport(value: unknown): value is FieldSupervisorReport {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<FieldSupervisorReport>;
  return (
    v.schema === "stormpath.field_supervisor.v1" &&
    typeof v.watchId === "string" &&
    isSupervisorWatchId(v.watchId) &&
    typeof v.recovered === "boolean" &&
    typeof v.recovery === "string" &&
    typeof v.online === "boolean"
  );
}
