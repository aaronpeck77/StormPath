import { useLayoutEffect } from "react";

const SHELL_FOOT_VAR = "--nav-progress-rail-foot-inset";
const SHELL_STRIP_VAR = "--nav-progress-rail-strip-length";
const GAP_ABOVE_CHROME_PX = 12;
const MIN_FOOT_INSET_PX = 12;

/**
 * Size the vertical progress rail from the top of the bottom chrome (address row, route select,
 * toolbar) so the strip start/end stays above that band — not a fixed px guess.
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

    const update = () => {
      const rail = document.querySelector<HTMLElement>(".nav-route-progress-rail");
      const inner = document.querySelector<HTMLElement>(".nav-route-progress-rail__inner");
      const anchorEl =
        document.querySelector<HTMLElement>(".nav-bottom-chrome-wrap") ??
        document.querySelector<HTMLElement>(".nav-bottom-stack");
      if (!rail || !inner || !anchorEl) return;

      const railRect = rail.getBoundingClientRect();
      const anchorRect = anchorEl.getBoundingClientRect();
      if (anchorRect.height < 1) return;

      const overlapW =
        Math.min(railRect.right, anchorRect.right) - Math.max(railRect.left, anchorRect.left);

      if (overlapW > 20) {
        const anchorTop = anchorRect.top;
        const footInset = Math.ceil(window.innerHeight - anchorTop + GAP_ABOVE_CHROME_PX);
        shell.style.setProperty(
          SHELL_FOOT_VAR,
          `${Math.max(MIN_FOOT_INSET_PX, footInset)}px`
        );

        const innerTop = inner.getBoundingClientRect().top;
        const stripLen = Math.max(48, Math.floor(anchorTop - innerTop - GAP_ABOVE_CHROME_PX));
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
