import { METERS_PER_MILE } from "./constants";

/**
 * Driver framing for the chosen exit window — drives the panel copy so the user knows whether
 * they're getting a leisurely "next two miles" plan or a "next exit, hurry" recommendation.
 */
export type SurgicalBypassFraming = "plenty" | "tight" | "nextExit";

export type SurgicalBypassWindow = {
  /** Where to start the side-road leg (m along the active route from origin). */
  exitMeters: number;
  /** Where to attempt rejoining the active route (m along; Mapbox may pick an on-ramp earlier/later). */
  rejoinMeters: number;
  /** UI hint; see {@link SurgicalBypassFraming}. */
  framing: SurgicalBypassFraming;
};

/**
 * Choose where to slice the surgical (side-road) bypass relative to the impact, scaling the
 * exit/rejoin span to how much room is left before the jam and how fast the driver is going.
 *
 * Intent:
 * - Plenty of lead time → a comfortable 2 mi pre-jam exit + 3 mi rejoin (current default).
 * - Closing in → shorter pre-jam buffer, anchored to the user's current position so Mapbox
 *   picks the *next available* off-ramp instead of one already passed.
 * - Right on top of the jam → return `null` so the caller offers only the full reroute (B).
 *
 * Speed-aware floor: the user must have at least ~30 s before reaching the jam to make a safe
 * exit. Below that threshold a surgical bypass is essentially a guess they can't act on.
 */
export function computeSurgicalBypassWindow(opts: {
  /** User's current along-route position on the active leg (m). */
  userAlongMeters: number;
  /** Center of the hazard along the active leg (m). */
  jamAlongMeters: number;
  /** Total length of the active leg (m). */
  totalMeters: number;
  /** Live speed in m/s; null/0 falls back to a conservative 25 m/s (~56 mph) floor. */
  speedMps: number | null;
}): SurgicalBypassWindow | null {
  const { userAlongMeters, jamAlongMeters, totalMeters } = opts;
  if (!Number.isFinite(totalMeters) || totalMeters <= 0) return null;
  if (!Number.isFinite(userAlongMeters) || !Number.isFinite(jamAlongMeters)) return null;

  const gap = jamAlongMeters - userAlongMeters;
  if (gap <= 0) return null;

  /** Conservative speed floor for the lead-time check — we'd rather under-trigger than tell
   *  the user to "exit now" when they physically can't. */
  const speed = opts.speedMps && opts.speedMps > 0 ? opts.speedMps : 25;
  /** ≥30 s of lead time, with a ~250 m absolute floor for very-low-speed cases. */
  const minLeadTimeM = Math.max(250, speed * 30);
  if (gap < minLeadTimeM) return null;

  const MI = METERS_PER_MILE;
  let exitM: number;
  let rejoinM: number;
  let framing: SurgicalBypassFraming;

  if (gap > 2 * MI) {
    /* Plenty: classic "exit 2 mi back, rejoin 3 mi past" — fits cleanly on interstate trips. */
    exitM = jamAlongMeters - 2 * MI;
    rejoinM = jamAlongMeters + 3 * MI;
    framing = "plenty";
  } else if (gap > 0.8 * MI) {
    /* Tight: split the difference so Mapbox still has a workable highway segment to leave from,
     * and trim the rejoin so we don't add unnecessary side-road miles past the jam. */
    exitM = userAlongMeters + gap * 0.5;
    rejoinM = jamAlongMeters + 2 * MI;
    framing = "tight";
  } else {
    /* Next-exit: anchor the entry to the user's current position (a touch ahead so Mapbox can't
     * pick an off-ramp behind them) and keep the rejoin short. */
    const minAhead = Math.max(0.15 * MI, speed * 6);
    exitM = userAlongMeters + Math.min(minAhead, gap * 0.4);
    rejoinM = jamAlongMeters + 1.5 * MI;
    framing = "nextExit";
  }

  exitM = Math.max(0, Math.min(totalMeters, exitM));
  rejoinM = Math.max(0, Math.min(totalMeters, rejoinM));

  /* Need a meaningful detour span; otherwise let the full reroute carry the choice. */
  if (rejoinM - exitM < 0.6 * MI) return null;

  return { exitMeters: exitM, rejoinMeters: rejoinM, framing };
}

/**
 * Banner lead-time threshold scaled by current speed — at interstate speeds we want the
 * driver to know about a major hazard 6 minutes out (≈6.5 mi at 65 mph), not just ~5 mi
 * which would only buy ~4 minutes of warning.
 */
export function earlyApproachMaxMetersForSpeed(speedMps: number | null): number {
  const FALLBACK_MAX = 5 * METERS_PER_MILE;
  const HARD_CAP = 8 * METERS_PER_MILE;
  if (!speedMps || speedMps <= 0) return FALLBACK_MAX;
  /* 6 minutes worth of distance at the current speed, clamped between 5 mi and 8 mi. */
  const sixMin = speedMps * 360;
  return Math.min(HARD_CAP, Math.max(FALLBACK_MAX, sixMin));
}
