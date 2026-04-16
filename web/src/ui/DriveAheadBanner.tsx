import { useEffect, useMemo, useRef } from "react";
import type { LngLat } from "../nav/types";
import type { RouteAlert } from "../nav/routeAlerts";
import { pickDriveAheadCandidate } from "../nav/driveAheadPick";

type Props = {
  active: boolean;
  tripKey: string;
  geometry: LngLat[] | undefined;
  userLngLat: LngLat | null;
  alerts: RouteAlert[];
  onInspectHazardOverview: (lng: number, lat: number) => void;
  onOpenRouteView: () => void;
  onRerouteHint: () => void;
};

export function DriveAheadBanner({
  active,
  tripKey,
  geometry,
  userLngLat,
  alerts,
  onInspectHazardOverview,
  onOpenRouteView,
  onRerouteHint,
}: Props) {
  const announcedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    announcedRef.current.clear();
  }, [tripKey]);

  const pick = useMemo(
    () =>
      pickDriveAheadCandidate(active, geometry, userLngLat, alerts, {
        seriousOnly: true,
      }),
    [active, geometry, userLngLat, alerts]
  );

  useEffect(() => {
    if (!pick) return;
    const id = pick.alert.id;
    if (announcedRef.current.has(id)) return;
    announcedRef.current.add(id);
    try {
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate(120);
      }
    } catch {
      /* ignore */
    }
  }, [pick]);

  if (!pick) return null;

  const { alert, aheadMi } = pick;
  const miLabel = aheadMi >= 0.95 ? `${aheadMi.toFixed(1)} mi` : `${Math.max(0.1, aheadMi).toFixed(1)} mi`;

  return (
    <div className="nav-drive-ahead nav-drive-ahead--compact" role="alert" aria-live="polite">
      <span className="nav-drive-ahead__badge">!</span>
      <span className="nav-drive-ahead__one">
        <strong>{alert.title}</strong> · {miLabel} — {alert.detail}
      </span>
      <div className="nav-drive-ahead__actions">
        <button
          type="button"
          className="nav-drive-ahead__btn nav-drive-ahead__btn--map"
          onClick={() => onInspectHazardOverview(alert.lngLat[0]!, alert.lngLat[1]!)}
        >
          Map
        </button>
        <button type="button" className="nav-drive-ahead__btn" onClick={onOpenRouteView}>
          Routes
        </button>
        <button type="button" className="nav-drive-ahead__btn nav-drive-ahead__btn--hint" onClick={onRerouteHint}>
          Help
        </button>
      </div>
    </div>
  );
}
