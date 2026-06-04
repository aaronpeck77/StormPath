/** Dev-only custom cursors: dark dot with a white ring (readable on the dark map UI). */

function devCursorSvg(fill: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><circle cx="14" cy="14" r="9" fill="${fill}" stroke="#ffffff" stroke-width="2.5"/></svg>`;
}

function devCursorUrl(fill: string, fallback: string): string {
  const encoded = encodeURIComponent(devCursorSvg(fill));
  return `url("data:image/svg+xml,${encoded}") 14 14, ${fallback}`;
}

export const DEV_CURSOR_DEFAULT = devCursorUrl("rgba(28, 30, 36, 0.92)", "default");
export const DEV_CURSOR_POINTER = devCursorUrl("rgba(37, 99, 235, 0.88)", "pointer");

/** Mapbox canvas uses inline cursor; normalize to the dev ring cursors. */
export function resolveDevMapCanvasCursor(requested: string): string {
  if (!import.meta.env.DEV) return requested;
  return requested === "pointer" ? DEV_CURSOR_POINTER : DEV_CURSOR_DEFAULT;
}
