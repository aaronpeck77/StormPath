import { useLayoutEffect } from "react";

const SHELL_FOOT_VAR = "--nav-progress-rail-foot-inset";
const SHELL_STRIP_VAR = "--nav-progress-rail-strip-length";
const GAP_ABOVE_CHROME_PX = 12;
const MIN_FOOT_INSET_PX = 12;
/* Keep at least this much rail column visible even if chrome measures tall. */
const MIN_RAIL_HEIGHT_PX = 120;
/* Anchors must live in the bottom half of the screen — a full-height side
 * panel (.nav-bottom-stack on iPad landscape) reports top≈0 and would erase
 * the rail if trusted. */
const ANCHOR_MIN_TOP_RATIO = 0.35;

/**
 * Size the vertical progress rail from the top of the bottom chrome (address row, route select,
 * toolbar) so the strip start/end stays above that band — not a fixed px guess.
 *
 * The anchor is measured directly, not gated on horizontal overlap: on iPad
 * portrait/landscape the rail sits on the opposite edge from the centered or
 * panel chrome, so an overlap test left the strip running to the screen edge.
 */
export function useProgressRailFootInset(active: boolean): void {
  useLayoutEffect(() => {
    const shell = document.querySelector<HTMLElement>(".app-shell.nav-fullmap");
    if (!active || !shell) {
      shell?.style.removeProperty(SHELL_FOOT_VAR);
      shell?.style.removeProperty(SHELL_STRIP_VAR);
      return;
    }

    let raf = 0;
    /* Phone landscape runs the strip the full screen height (Bill's ask) —
     * skip chrome anchoring entirely; CSS spans the rail across both grid rows. */
    const phoneLandscapeMq =
      typeof window !== "undefined"
        ? window.matchMedia("(orientation: landscape) and (max-height: 500px)")
        : null;

    const update = () => {
      const rail = document.querySelector<HTMLElement>(".nav-route-progress-rail");
      const inner = document.querySelector<HTMLElement>(".nav-route-progress-rail__inner");
      if (!rail || !inner) return;

      if (phoneLandscapeMq?.matches) {
        const safeBottom = Number.parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue("env(safe-area-inset-bottom)") ||
            "0"
        );
        shell.style.setProperty(
          SHELL_FOOT_VAR,
          `${Math.max(MIN_FOOT_INSET_PX, Math.ceil(safeBottom + 4))}px`
        );
        /* No strip-length override → .route-progress-strip--side falls back to
         * 100cqh = the rail inner's full height. */
        shell.style.removeProperty(SHELL_STRIP_VAR);
        return;
      }

      /* Bottom anchor = top of the bottom chrome band. Take the highest valid
       * top across the chrome wrap and landscape dock so the strip clears the
       * whole cluster (dock row included), wherever it sits. Do NOT anchor on
       * .nav-bottom-stack: transient widgets (hazard panel, PiP, banners) sit
       * above the chrome inside it and would shrink the rail on phones. */
      const vh = window.innerHeight;
      /* On iPad landscape, the side command panel sits on the right/left while the
       * progress rail runs full screen height on the opposite edge. Anchoring to
       * the bottom of the side panel would cut the rail in half. Check for iPad landscape. */
      const isIpadLandscape =
        window.matchMedia("(orientation: landscape) and (min-width: 800px) and (min-height: 600px)").matches;

      let anchorTop: number | null = null;
      if (!isIpadLandscape) {
        for (const sel of [
          ".nav-bottom-chrome-wrap",
          ".landscape-navigation-dock",
        ]) {
          const el = document.querySelector<HTMLElement>(sel);
          if (!el) continue;
          const rect = el.getBoundingClientRect();
          if (rect.height < 1 || rect.top <= vh * ANCHOR_MIN_TOP_RATIO) continue;
          anchorTop = anchorTop == null ? rect.top : Math.min(anchorTop, rect.top);
        }
      }

      if (anchorTop != null) {
        const footInset = Math.min(
          Math.ceil(vh - anchorTop + GAP_ABOVE_CHROME_PX),
          Math.max(MIN_FOOT_INSET_PX, vh - MIN_RAIL_HEIGHT_PX)
        );
        shell.style.setProperty(SHELL_FOOT_VAR, `${footInset}px`);

        const innerRect = inner.getBoundingClientRect();
        const stripLen = Math.max(
          48,
          Math.min(
            Math.floor(anchorTop - innerRect.top - GAP_ABOVE_CHROME_PX),
            Math.floor(innerRect.height)
          )
        );
        shell.style.setProperty(SHELL_STRIP_VAR, `${stripLen}px`);
        return;
      }

      const safeBottom = Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue("env(safe-area-inset-bottom)") ||
          "0"
      );
      shell.style.setProperty(
        SHELL_FOOT_VAR,
        `${Math.max(MIN_FOOT_INSET_PX, Math.ceil(safeBottom + 4))}px`
      );
      shell.style.removeProperty(SHELL_STRIP_VAR);
    };

    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        update();
        raf = requestAnimationFrame(update);
      });
    };

    schedule();
    const ro = new ResizeObserver(schedule);
    for (const sel of [
      ".nav-bottom-stack",
      ".nav-bottom-chrome-wrap",
      ".nav-bottom-dock",
      ".nav-route-progress-rail",
    ]) {
      const el = document.querySelector(sel);
      if (el) ro.observe(el);
    }
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
      shell.style.removeProperty(SHELL_FOOT_VAR);
      shell.style.removeProperty(SHELL_STRIP_VAR);
    };
  }, [active]);
}
