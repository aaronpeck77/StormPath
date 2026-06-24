import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Hide expanded body when there is nothing to show. */
  hasContent: boolean;
  children: ReactNode;
  /** Re-fetch corridor temp/precip for the route outlook graph. */
  showRefresh?: boolean;
  refreshBusy?: boolean;
  refreshNote?: string | null;
  /** Info = cached/stale data shown; warn = nothing to show yet. */
  refreshNoteTone?: "info" | "warn";
  onRefresh?: () => void;
};

/**
 * Expanded route-info panel — `position: fixed` over the map (same anchoring pattern as
 * {@link StormAdvisoryBar}). Opened by tapping {@link RouteProgressStrip} on the side rail.
 */
export function RouteProgressCalloutRail({
  open,
  onOpenChange,
  hasContent,
  children,
  showRefresh = false,
  refreshBusy = false,
  refreshNote = null,
  refreshNoteTone = "warn",
  onRefresh,
}: Props) {
  const [tapBusy, setTapBusy] = useState(false);
  const tapBusyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (refreshBusy) return;
    if (tapBusyTimerRef.current != null) return;
    setTapBusy(false);
  }, [refreshBusy]);

  useEffect(
    () => () => {
      if (tapBusyTimerRef.current != null) window.clearTimeout(tapBusyTimerRef.current);
    },
    []
  );

  const handleRefresh = () => {
    if (!onRefresh || refreshBusy || tapBusy) return;
    setTapBusy(true);
    onRefresh();
    // Minimum busy time so the label doesn't flicker on fast fetches.
    tapBusyTimerRef.current = window.setTimeout(() => {
      tapBusyTimerRef.current = null;
      if (!refreshBusy) setTapBusy(false);
    }, 900);
  };

  const refreshLabelBusy = refreshBusy || tapBusy;
  useLayoutEffect(() => {
    if (!open || !hasContent) return;
    const bottomStack = document.querySelector<HTMLElement>(".nav-bottom-stack");
    const anchorEl = () =>
      document.querySelector<HTMLElement>("#storm-advisory-panel-toggle") ??
      document.querySelector<HTMLElement>(".nav-top-cluster");
    const propagate = () => {
      const bandRect = anchorEl()?.getBoundingClientRect();
      const root = document.documentElement;
      if (bandRect) {
        root.style.setProperty("--route-progress-callout-anchor-top", `${Math.round(bandRect.top)}px`);
        root.style.setProperty("--route-progress-callout-anchor-left", `${Math.round(bandRect.left)}px`);
        root.style.setProperty(
          "--route-progress-callout-anchor-right",
          `${Math.round(window.innerWidth - bandRect.right)}px`
        );
      } else {
        root.style.setProperty("--route-progress-callout-anchor-top", "56px");
        root.style.setProperty("--route-progress-callout-anchor-left", "14px");
        root.style.setProperty("--route-progress-callout-anchor-right", "14px");
      }
      if (bottomStack) {
        const bRect = bottomStack.getBoundingClientRect();
        const raw = Math.round(window.innerHeight - bRect.top + 8);
        const inset = Math.max(40, Math.min(raw, Math.round(window.innerHeight * 0.4)));
        root.style.setProperty("--route-progress-callout-bottom-inset", `${inset}px`);
      }
    };
    propagate();
    const ro = new ResizeObserver(propagate);
    const band = anchorEl();
    if (band) ro.observe(band);
    if (bottomStack) ro.observe(bottomStack);
    window.addEventListener("resize", propagate);
    window.addEventListener("orientationchange", propagate);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", propagate);
      window.removeEventListener("orientationchange", propagate);
      document.documentElement.style.removeProperty("--route-progress-callout-anchor-top");
      document.documentElement.style.removeProperty("--route-progress-callout-anchor-left");
      document.documentElement.style.removeProperty("--route-progress-callout-anchor-right");
      document.documentElement.style.removeProperty("--route-progress-callout-bottom-inset");
    };
  }, [open, hasContent]);

  const showPanel = open && hasContent;
  if (!showPanel) return null;

  return (
    <div
      id="route-progress-callout-panel"
      className="route-progress-callout-panel route-progress-callout-panel--expanded"
      role="region"
      aria-label="Route progress and hazards"
    >
      <div className="route-progress-callout-panel__head">
        <div className="route-progress-callout-panel__head-leading">
          <span className="route-progress-callout-panel__title">Route info</span>
          <span className="route-progress-callout-panel__subtitle">
            Weather, radar, wind, and hazards along your drive
          </span>
        </div>
        <div className="route-progress-callout-panel__head-actions">
          {showRefresh && onRefresh ? (
            <button
              type="button"
              className="route-progress-callout-panel__refresh"
              disabled={refreshLabelBusy}
              onPointerDownCapture={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleRefresh();
              }}
              title="Reload corridor temperature, rain, wind, and radar samples"
              aria-label="Refresh route weather and hazard outlook"
            >
              {refreshLabelBusy ? "Refreshing…" : "Refresh"}
            </button>
          ) : null}
          <button
            type="button"
            className="route-progress-callout-panel__close"
            onPointerDownCapture={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onOpenChange(false);
            }}
            aria-expanded
            aria-controls="route-progress-callout-panel"
            title="Close route info"
            aria-label="Close route info"
          >
            Close
          </button>
        </div>
      </div>
      {refreshNote ? (
        <p
          className={`route-progress-callout-panel__refresh-note route-progress-callout-panel__refresh-note--${refreshNoteTone}`}
          role="status"
        >
          {refreshNote}
        </p>
      ) : null}
      <div className="route-progress-callout-panel__body">{children}</div>
    </div>
  );
}
