/** Dev-only custom cursors: high-contrast ring so the pointer stays visible on the dark map UI. */

function devCursorSvg(fill: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
    <circle cx="18" cy="18" r="13" fill="none" stroke="#000000" stroke-width="6" opacity="0.72"/>
    <circle cx="18" cy="18" r="13" fill="none" stroke="#ffffff" stroke-width="5"/>
    <circle cx="18" cy="18" r="9.5" fill="${fill}" stroke="#ffffff" stroke-width="3"/>
  </svg>`;
}

function devCursorUrl(fill: string, fallback: string): string {
  const encoded = encodeURIComponent(devCursorSvg(fill));
  return `url("data:image/svg+xml,${encoded}") 18 18, ${fallback}`;
}

export const DEV_CURSOR_DEFAULT = devCursorUrl("rgba(22, 24, 30, 0.94)", "default");
export const DEV_CURSOR_POINTER = devCursorUrl("rgba(59, 130, 246, 0.95)", "pointer");

/** Mapbox canvas uses inline cursor; normalize to the dev ring cursors. */
export function resolveDevMapCanvasCursor(requested: string): string {
  if (!import.meta.env.DEV) return requested;
  return requested === "pointer" ? DEV_CURSOR_POINTER : DEV_CURSOR_DEFAULT;
}
