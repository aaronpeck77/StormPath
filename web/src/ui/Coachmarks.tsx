import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import {
  FIRST_LAUNCH_COACHMARK_STEPS,
  isCoachmarkStepSeen,
  markCoachmarkStepSeen,
  type CoachmarkAnchor,
  type CoachmarkStep,
} from "./coachmarks/firstLaunchSteps";

/**
 * Contextual one-shot coachmarks.
 *
 * The component renders nothing until one of its tracked tips has a visible target on
 * screen AND that tip hasn't been dismissed before. When that happens, a small explanatory
 * card pops next to the target with a single "Got it" button. Dismiss → mark this tip
 * "seen" forever (per-device localStorage), then look for the next un-seen tip whose
 * target is visible. If none are visible right now, render nothing and wait.
 *
 * Why this shape:
 *   - The user explicitly asked for "explain it to them the first time it pops up" — a
 *     contextual reveal beats a forced linear walkthrough. The advisory bar tip plays as
 *     soon as the app loads (target is on screen). The progress-rail tip waits silently
 *     until the user actually has a route (and explains tapping the bar to open Route info).
 *     The view-cycle tip plays the first time the
 *     button becomes interactable. Etc.
 *   - One tip at a time: the queue is in priority order (see firstLaunchSteps). If two
 *     targets are visible simultaneously, the higher-priority one shows first; once
 *     dismissed, the next one's effect pass picks up the next.
 *
 * Replay: bumping {@link CoachmarksProps.replayKey} resets the local "armed" state. The
 * caller is expected to also call resetAllCoachmarks() before bumping the key so the
 * persisted "seen" flags clear. About sheet's "Replay quick tour" entry does both.
 */

const VIEWPORT_PADDING = 12;
const CARD_WIDTH = 280;
/** Gap between the card edge and the target it points at. Larger than the old 16px so that
 * the card visibly clears the target — users specifically asked for more breathing room
 * between the tip and the thing it's explaining. */
const CARD_GAP = 22;
/** When the card sits ABOVE the target, we anchor by the card's bottom edge via
 * `transform: translateY(-100%)` rather than guessing the card's rendered height. This
 * minimum just guards "is there enough vertical room above the target at all?" and is
 * intentionally generous so we don't try to cram a card into a tiny strip. */
const MIN_ABOVE_HEIGHT = 110;
/** Minimum target rect size for a tip to fire — guards against zero-sized stub elements. */
const MIN_TARGET_SIZE = 12;
/** Polling interval for "is the target on screen yet?" checks. Cheap (a few querySelectors)
 * and only runs while at least one tip remains un-seen. */
const POLL_INTERVAL_MS = 600;

type Position = {
  /** Final card top-left in px (clamped to the viewport). For above-anchored cards this is
   * where the card's BOTTOM edge should sit — combined with `anchorBottom: true` and a CSS
   * transform, the card pushes upward by its own rendered height so there's no chance of
   * clipping into the target regardless of how tall the card actually is. */
  top: number;
  left: number;
  /** When true, the card is anchored by its bottom edge (translateY(-100%)). Used for
   * above-anchored cards so card height doesn't have to be known up front. */
  anchorBottom: boolean;
  /** Highlight ring around the target — null when target wasn't found. */
  highlight:
    | {
        top: number;
        left: number;
        width: number;
        height: number;
      }
    | null;
  /** Side used (informs arrow direction). */
  side: CoachmarkAnchor;
};

function rectIsVisible(rect: DOMRect): boolean {
  if (rect.width < MIN_TARGET_SIZE || rect.height < MIN_TARGET_SIZE) return false;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  /* At least partially intersect the viewport. (Hidden elements with display:none collapse
   * to a 0×0 rect at top:0/left:0; the size check above already filters those.) */
  if (rect.bottom < 0 || rect.right < 0) return false;
  if (rect.top > vh || rect.left > vw) return false;
  return true;
}

function placeCard(rect: DOMRect | null, preferred: CoachmarkAnchor): Position {
  if (!rect) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return {
      top: Math.max(VIEWPORT_PADDING, vh / 2 - 80),
      left: Math.max(VIEWPORT_PADDING, vw / 2 - CARD_WIDTH / 2),
      anchorBottom: false,
      highlight: null,
      side: "auto",
    };
  }
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  /* Used only as a "minimum room" check for sides where the card is anchored by its top
   * (below / left / right). Above-anchored cards don't use this — they push upward from
   * `top = rect.top - CARD_GAP` via translateY(-100%), so their actual height is irrelevant
   * to the placement math. */
  const minCardHeight = 130;

  const trySide = (side: CoachmarkAnchor): Position | null => {
    if (side === "above") {
      /* Need at least MIN_ABOVE_HEIGHT pixels above the target to fit a card. */
      if (rect.top - CARD_GAP - VIEWPORT_PADDING < MIN_ABOVE_HEIGHT) return null;
      const left = clamp(
        rect.left + rect.width / 2 - CARD_WIDTH / 2,
        VIEWPORT_PADDING,
        vw - CARD_WIDTH - VIEWPORT_PADDING
      );
      return {
        /* `top` is where the card's BOTTOM edge should sit — translateY(-100%) handles the
         * rest at render time. */
        top: rect.top - CARD_GAP,
        left,
        anchorBottom: true,
        highlight: rectAsHighlight(rect),
        side,
      };
    }
    if (side === "below") {
      const top = rect.bottom + CARD_GAP;
      if (top + minCardHeight > vh - VIEWPORT_PADDING) return null;
      const left = clamp(
        rect.left + rect.width / 2 - CARD_WIDTH / 2,
        VIEWPORT_PADDING,
        vw - CARD_WIDTH - VIEWPORT_PADDING
      );
      return { top, left, anchorBottom: false, highlight: rectAsHighlight(rect), side };
    }
    if (side === "left") {
      const left = rect.left - CARD_WIDTH - CARD_GAP;
      if (left < VIEWPORT_PADDING) return null;
      const top = clamp(
        rect.top + rect.height / 2 - minCardHeight / 2,
        VIEWPORT_PADDING,
        vh - minCardHeight - VIEWPORT_PADDING
      );
      return { top, left, anchorBottom: false, highlight: rectAsHighlight(rect), side };
    }
    if (side === "right") {
      const left = rect.right + CARD_GAP;
      if (left + CARD_WIDTH > vw - VIEWPORT_PADDING) return null;
      const top = clamp(
        rect.top + rect.height / 2 - minCardHeight / 2,
        VIEWPORT_PADDING,
        vh - minCardHeight - VIEWPORT_PADDING
      );
      return { top, left, anchorBottom: false, highlight: rectAsHighlight(rect), side };
    }
    return null;
  };

  const order: CoachmarkAnchor[] =
    preferred === "auto"
      ? ["above", "below", "left", "right"]
      : [preferred, ...(["above", "below", "left", "right"] as const).filter((s) => s !== preferred)];

  for (const s of order) {
    const placed = trySide(s);
    if (placed) return placed;
  }
  return {
    top: Math.max(VIEWPORT_PADDING, vh / 2 - minCardHeight / 2),
    left: Math.max(VIEWPORT_PADDING, vw / 2 - CARD_WIDTH / 2),
    anchorBottom: false,
    highlight: rectAsHighlight(rect),
    side: "auto",
  };
}

function rectAsHighlight(rect: DOMRect) {
  const pad = 6;
  return {
    top: Math.max(0, rect.top - pad),
    left: Math.max(0, rect.left - pad),
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export type CoachmarksProps = {
  /** Bumping this re-arms the queue and re-checks for un-seen tips. Caller should clear
   * persisted flags via resetAllCoachmarks() before bumping if a full replay is wanted. */
  replayKey?: number;
  /** Defaults to the first-launch step list; supplied for tests. */
  steps?: readonly CoachmarkStep[];
  /** Delay before the first poll runs after mount / replay. Lets the map / chrome settle so
   * we don't measure mid-layout-shift. Default 1.6 s. */
  initialDelayMs?: number;
};

export function Coachmarks({
  replayKey = 0,
  steps = FIRST_LAUNCH_COACHMARK_STEPS,
  initialDelayMs = 1_600,
}: CoachmarksProps) {
  /** The tip currently showing, or null when none is showing (either nothing un-seen has a
   * visible target right now, or we're between tips). */
  const [activeStep, setActiveStep] = useState<CoachmarkStep | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  /** Per-component tracking of which tips have been dismissed THIS session. Mirrors what's
   * already in localStorage but lets us update without a re-read after dismissal. */
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({});

  /* Reset dismissal tracking when the replay key changes — the parent has presumably also
   * cleared the persisted flags, so this gives the queue a clean slate. */
  useEffect(() => {
    setDismissed({});
    setActiveStep(null);
    setPosition(null);
  }, [replayKey]);

  /* Polling loop: every {@link POLL_INTERVAL_MS} (after an initial settle delay), look for
   * the first un-seen step whose target is currently visible, and surface it. Stops itself
   * once every step has been dismissed. */
  useEffect(() => {
    if (activeStep) return;
    let stopped = false;

    const findNext = () => {
      if (stopped) return;
      for (const step of steps) {
        if (dismissed[step.id]) continue;
        if (isCoachmarkStepSeen(step.id)) continue;
        const el = document.querySelector<HTMLElement>(step.targetSelector);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (!rectIsVisible(rect)) continue;
        setActiveStep(step);
        return;
      }
    };

    const allSeen = steps.every((s) => dismissed[s.id] || isCoachmarkStepSeen(s.id));
    if (allSeen) return;

    const startTimer = window.setTimeout(findNext, initialDelayMs);
    const poll = window.setInterval(findNext, POLL_INTERVAL_MS);
    return () => {
      stopped = true;
      window.clearTimeout(startTimer);
      window.clearInterval(poll);
    };
  }, [activeStep, dismissed, steps, initialDelayMs, replayKey]);

  /* Position the active card relative to its target, and re-measure on resize / scroll /
   * orientation changes so the spotlight stays glued to the element. */
  useLayoutEffect(() => {
    if (!activeStep) {
      setPosition(null);
      return;
    }
    const measure = () => {
      const el = document.querySelector<HTMLElement>(activeStep.targetSelector);
      const rect = el?.getBoundingClientRect() ?? null;
      /* If the target disappeared between the queue picking it up and us measuring, fall
       * back to a centered placement rather than a janky off-screen card. */
      setPosition(placeCard(rect, activeStep.preferredAnchor));
    };
    measure();
    const raf = requestAnimationFrame(measure);
    const ro = new ResizeObserver(measure);
    const targetEl = document.querySelector<HTMLElement>(activeStep.targetSelector);
    if (targetEl) ro.observe(targetEl);
    ro.observe(document.body);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    window.addEventListener("orientationchange", measure);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("orientationchange", measure);
    };
  }, [activeStep]);

  const dismissActive = useCallback(() => {
    if (!activeStep) return;
    markCoachmarkStepSeen(activeStep.id);
    setDismissed((prev) => ({ ...prev, [activeStep.id]: true }));
    setActiveStep(null);
    setPosition(null);
  }, [activeStep]);

  if (!activeStep || !position) return null;

  return (
    <div
      className={`coachmarks${position.highlight ? "" : " coachmarks--no-target"}`}
      role="dialog"
      aria-modal="false"
      aria-labelledby="coachmark-title"
      aria-describedby="coachmark-body"
    >
      {position.highlight ? (
        <div
          className="coachmarks__highlight"
          aria-hidden="true"
          style={{
            top: position.highlight.top,
            left: position.highlight.left,
            width: position.highlight.width,
            height: position.highlight.height,
          }}
        />
      ) : (
        <div className="coachmarks__backdrop" aria-hidden="true" />
      )}
      {/* Outer wrapper carries the absolute positioning + (when anchored from the bottom)
       *  the translateY(-100%) — keeping the inner card free to run its entry animation
       *  on transform without that animation overwriting the anchor offset. */}
      <div
        className={`coachmarks__card-wrap${position.anchorBottom ? " coachmarks__card-wrap--anchor-bottom" : ""}`}
        style={{
          top: position.top,
          left: position.left,
          width: CARD_WIDTH,
        }}
      >
      <div
        className={`coachmarks__card coachmarks__card--side-${position.side}`}
      >
        <div className="coachmarks__tip-label">Tip</div>
        <h2 id="coachmark-title" className="coachmarks__title">
          {activeStep.title}
        </h2>
        <p id="coachmark-body" className="coachmarks__body">
          {activeStep.body}
        </p>
        <div className="coachmarks__actions coachmarks__actions--single">
          <button
            type="button"
            className="coachmarks__btn coachmarks__btn--primary"
            onClick={dismissActive}
            autoFocus
          >
            Got it
          </button>
        </div>
      </div>
      </div>
    </div>
  );
}
