import { useEffect, useState } from "react";

/**
 * True when the tab / WebView is visible. Polling and radar animation should pause when false
 * to save cellular data and battery.
 */
export function useAppForeground(): boolean {
  const [foreground, setForeground] = useState(() =>
    typeof document === "undefined" ? true : document.visibilityState === "visible"
  );

  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVis = () => setForeground(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  return foreground;
}
