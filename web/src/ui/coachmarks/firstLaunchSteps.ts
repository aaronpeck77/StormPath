/**
 * Contextual one-shot coachmark definitions.
 *
 * Each tip explains a single piece of UI the user can't easily guess at a glance. The tip
 * fires the first time its target actually becomes visible on screen — i.e. as the user
 * naturally encounters each piece of chrome — rather than as a forced-up-front walkthrough.
 *
 * Per-tip persistence: each entry has its own storage key so dismissing one (Got it)
 * doesn't suppress the others. About → Help → Replay quick tour clears all of them.
 */

import { safeStorage } from "../../storage/safeStorage";

export type CoachmarkAnchor = "auto" | "above" | "below" | "left" | "right";

export type CoachmarkStep = {
  /** Stable id used as the persistence key suffix and for analytics. */
  id: string;
  /**
   * CSS selector for the element this tip points at. The component reads
   * `getBoundingClientRect()` to position the card AND uses the rect to decide whether
   * the target is "really visible" (non-zero size + at least partially in the viewport).
   */
  targetSelector: string;
  /** Preferred anchor side relative to the target. `auto` picks the side with the most room. */
  preferredAnchor: CoachmarkAnchor;
  /** Headline shown at the top of the card. */
  title: string;
  /** One- or two-sentence body. Kept short so users can read at a glance. */
  body: string;
};

/** All tips, in queue order. When two targets are visible at the same time, the one earlier
 * in this list is shown first; the next pops once the first is dismissed. */
export const FIRST_LAUNCH_COACHMARK_STEPS: readonly CoachmarkStep[] = [
  {
    id: "advisory-bar",
    targetSelector: ".storm-advisory-bar--preview",
    preferredAnchor: "below",
    title: "Advisory bar",
    body:
      "Live weather and road status for where you are right now and along your route. Tap it to expand for forecasts, NWS alerts, and traffic.",
  },
  {
    id: "info-button",
    targetSelector: ".map-about-btn",
    preferredAnchor: "above",
    title: "Settings, map key, and help",
    body:
      "The i opens settings, the map color legend, your saved places and routes, the activity trail toggle, and other help info.",
  },
  {
    id: "view-cycle",
    targetSelector: ".nav-mode-cycle",
    preferredAnchor: "above",
    title: "Switch views",
    body:
      "This button cycles between Route plan, Drive, and Map (top-down) views. The two-letter label tells you what's active.",
  },
  {
    id: "add-a-stop",
    targetSelector: ".route-stops-bar__add",
    preferredAnchor: "above",
    title: "Add a stop",
    body:
      "After you pick a destination, tap here to add one stop on the way. Search or tap the map to place it — routes refresh with your stop before the final destination.",
  },
  {
    id: "progress-rail-v2",
    targetSelector: ".route-progress-strip--side",
    preferredAnchor: "left",
    title: "Open Route info from here",
    body:
      "This vertical bar on the map is your trip progress. Tap anywhere on the bar to open the Route info panel — colored bands, hazards, NWS weather, traffic, and forecast for what's ahead. There is no separate button anymore.",
  },
];

const STORAGE_PREFIX = "stormpath:coachmark:";
const STORAGE_VERSION = "v1";

function storageKey(id: string): string {
  return `${STORAGE_PREFIX}${id}:${STORAGE_VERSION}`;
}

/** Has the user already dismissed this specific tip on this device? */
export function isCoachmarkStepSeen(id: string): boolean {
  return safeStorage.get(storageKey(id)) === "done";
}

/** Record dismissal for one tip. Other tips remain in their pre-existing state. */
export function markCoachmarkStepSeen(id: string): void {
  safeStorage.set(storageKey(id), "done");
}

/** Wipe every per-step "seen" flag so all tips re-arm. Used by About → Replay quick tour. */
export function resetAllCoachmarks(): void {
  for (const step of FIRST_LAUNCH_COACHMARK_STEPS) {
    safeStorage.remove(storageKey(step.id));
  }
  /* Legacy tip ids from earlier tours. */
  safeStorage.remove(`${STORAGE_PREFIX}progress-rail:${STORAGE_VERSION}`);
  safeStorage.remove(`${STORAGE_PREFIX}route-info-panel:${STORAGE_VERSION}`);
}
