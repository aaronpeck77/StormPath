import { useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DriveCompass } from "./DriveCompass";
import { NavMilesLeftBox } from "./NavMilesLeftBox";

/** Large-tablet landscape only — matches 21-tablet.css command-panel gate. */
export const TABLET_LANDSCAPE_MQ =
  "(orientation: landscape) and (min-width: 800px) and (min-height: 600px)";

/**
 * Any command-panel landscape: iPad landscape OR phone landscape (short
 * viewports — the widened panel MQ in 21-tablet.css). Used for portals into
 * panel slots (TBT); the PiP keeps TABLET_LANDSCAPE_MQ so phones never mount it.
 */
export const PANEL_LANDSCAPE_MQ =
  "(orientation: landscape) and (min-width: 800px) and (min-height: 600px), (orientation: landscape) and (max-height: 500px)";

/**
 * Portal children into a slot inside the side command panel.
 * Falls back to rendering in place on portrait/narrow views, and whenever the
 * slot is absent (e.g. traffic-bypass compare hides panel widgets).
 */
export function TabletLandscapePanelPortal({
  slotId,
  active,
  children,
}: {
  slotId: string;
  active: boolean;
  children: ReactNode;
}) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [on, setOn] = useState(
    () => typeof window !== "undefined" && window.matchMedia(PANEL_LANDSCAPE_MQ).matches
  );
  useLayoutEffect(() => {
    const query = window.matchMedia(PANEL_LANDSCAPE_MQ);
    const update = () => {
      const matches = query.matches;
      setOn(matches);
      setTarget(active && matches ? document.getElementById(slotId) : null);
    };
    update();
    const observer = new MutationObserver(update);
    if (active) observer.observe(document.body, { childList: true, subtree: true });
    query.addEventListener("change", update);
    return () => {
      observer.disconnect();
      query.removeEventListener("change", update);
    };
  }, [active, slotId]);
  if (!active || !on || !target) return children;
  return createPortal(children, target);
}

export function LandscapeDockContent({ active, children }: { active: boolean; children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [landscape, setLandscape] = useState(() => typeof window !== "undefined" && window.matchMedia("(orientation: landscape)").matches);
  useLayoutEffect(() => {
    const query = window.matchMedia("(orientation: landscape)");
    const update = () => {
      setLandscape(query.matches);
      setTarget(active && query.matches ? document.getElementById("landscape-navigation-messages") : null);
    };
    update();
    const observer = new MutationObserver(update);
    if (active) observer.observe(document.body, { childList: true, subtree: true });
    query.addEventListener("change", update);
    return () => { observer.disconnect(); query.removeEventListener("change", update); };
  }, [active]);
  if (!active || !landscape) return children;
  return target ? createPortal(children, target) : null;
}

export function LandscapeNavigationDock({ miles, bearing, onRefresh, onInfo, onTools }: {
  miles: string | null;
  bearing: number | null;
  onRefresh?: () => void;
  onInfo: () => void;
  onTools?: () => void;
}) {
  return (
    <div className="landscape-navigation-dock">
      {/* DOM order = visual order in the iPad panel column: status messages and
       * miles-left above, button row last so it sits just over the bottom chrome.
       * Phone landscape positions these via grid-area names, so order is safe. */}
      <div id="landscape-navigation-messages" className="landscape-navigation-dock__messages" role="region" aria-label="Drive status bar" />
      <div className="landscape-navigation-dock__miles">
        {miles ? <NavMilesLeftBox label={miles} /> : null}
      </div>
      <div className="landscape-navigation-dock__controls">
        {/* DOM order preserved for phone landscape (vertical stack). The iPad
         * panel re-orders visually via CSS `order` in 21-tablet.css. */}
        {onRefresh ? <button type="button" className="trip-refresh-btn" aria-label="Refresh the trip" onClick={onRefresh}>↻</button> : null}
        <DriveCompass bearingDeg={bearing} />
        {onTools ? (
          <button
            type="button"
            className="nav-tools-btn"
            aria-label="StormPath Tools"
            title="StormPath Tools — trip log, ETA share, and more"
            onClick={onTools}
          >
            Tools
          </button>
        ) : null}
        <button type="button" className="map-about-btn" aria-label="About StormPath" onClick={onInfo}>i</button>
      </div>
    </div>
  );
}
