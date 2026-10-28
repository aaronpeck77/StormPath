import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DriveCompass } from "./DriveCompass";
import { NavMilesLeftBox } from "./NavMilesLeftBox";

export function LandscapeDockContent({ active, children }: { active: boolean; children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!active) { setTarget(null); return; }
    const query = window.matchMedia("(orientation: landscape)");
    const update = () => setTarget(query.matches ? document.getElementById("landscape-navigation-messages") : null);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [active]);
  return active && target ? createPortal(children, target) : children;
}

export function LandscapeNavigationDock({ miles, bearing, onRefresh, onInfo }: {
  miles: string | null;
  bearing: number | null;
  onRefresh?: () => void;
  onInfo: () => void;
}) {
  return (
    <div className="landscape-navigation-dock">
      <div className="landscape-navigation-dock__controls">
        {onRefresh ? <button type="button" className="trip-refresh-btn" aria-label="Refresh the trip" onClick={onRefresh}>↻</button> : null}
        <DriveCompass bearingDeg={bearing} />
        <button type="button" className="map-about-btn" aria-label="About StormPath" onClick={onInfo}>i</button>
      </div>
      <div className="landscape-navigation-dock__miles">
        {miles ? <NavMilesLeftBox label={miles} /> : null}
      </div>
      <div id="landscape-navigation-messages" className="landscape-navigation-dock__messages" />
    </div>
  );
}
