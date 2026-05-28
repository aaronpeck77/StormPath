import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
/* `vitest/config` re-exports `defineConfig` with the `test` option typed; the runtime config
 * is identical to `vite`'s, so dev/build are unaffected when Vitest isn't installed. */
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { rainViewerTileProxyOptions } from "./vite.rainViewerProxy";

const pkgPath = fileURLToPath(new URL("./package.json", import.meta.url));
const { version: appVersion } = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version: string };

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [
    react({
      /* React Compiler 1.0 (Phase 5d). The compiler runs as a Babel plugin during the
       * @vitejs/plugin-react transform pass and auto-memoizes hooks/components, eliminating
       * the need for hand-written `useMemo` / `useCallback` / `React.memo` in most cases.
       * For a map app where GPS ticks every second this is a real perf win — the existing
       * hand-memoized callbacks (especially in App.tsx) become belt-and-suspenders rather
       * than load-bearing. Empty options = use defaults (target: react@19, react-runtime
       * bundle, no rule overrides). */
      babel: {
        plugins: [["babel-plugin-react-compiler", {}]],
      },
    }),
  ],
  test: {
    /* Pure-logic tests only — no DOM. Add `environment: "jsdom"` later if React component tests land. */
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    /* Faster CI; we rarely care about wall-clock test count for ~50 tests. */
    reporters: process.env.CI ? "default" : ["default"],
    /* Keep tests deterministic — no global setup/teardown surprises. */
    clearMocks: true,
    restoreMocks: true,
  },
  /* Capacitor loads the built HTML from the device filesystem, so all asset
     paths must be relative (no leading /).  This has no effect on the Netlify
     web build because Netlify serves from the root anyway. */
  base: "./",
  resolve: {
    /* Phase 8.x — redirect ONLY the bare `mapbox-gl` specifier (not `mapbox-gl/dist/...`
     * subpaths) to the CSP-friendly build. The default mapbox-gl distribution spawns
     * its tile-decoding Web Workers from a `blob:` URL, which works on https:// and
     * http://localhost but is silently REJECTED by WebKit under `capacitor://localhost`.
     * Symptom in TestFlight build 122: TileJSON fetches succeed (req=11), style + layer
     * metadata parse fine (137 layers), but `tilesLoaded=n` forever because workers
     * never decode the vector tile data — so the render loop stalls (load=0, idle=0)
     * with zero errors. The CSP build instead loads its worker from an explicit
     * same-origin URL (see `mapboxgl.workerUrl =` setup in DriveMap.tsx), which is
     * permitted by every CSP. Using `find` as a regex restricted with `^...$` ensures
     * the alias doesn't rewrite `mapbox-gl/dist/mapbox-gl.css` or the explicit
     * `mapbox-gl/dist/mapbox-gl-csp-worker?url` import. Same JS surface — the
     * `mapboxgl` default export and all named type exports are identical between
     * the standard and CSP builds. */
    alias: [
      { find: /^mapbox-gl$/, replacement: "mapbox-gl/dist/mapbox-gl-csp" },
    ],
  },
  build: {
    rollupOptions: {
      output: {
        /* Vite 8 ships Rolldown (Rust-based Rollup successor) by default, which only accepts
         * the function form of `manualChunks` (object form is deprecated). Same outcome:
         * isolate `mapbox-gl` into its own ~1.8 MB chunk so the index chunk stays small and
         * the heavy map module only downloads when the route view first mounts. */
        manualChunks: (id) => {
          if (id.includes("node_modules/mapbox-gl/")) return "mapbox-gl";
          return undefined;
        },
      },
    },
  },
  server: {
    /* Lets you open the dev URL from your phone on the same Wi‑Fi (e.g. http://192.168.x.x:5173).
       That URL is not a “secure context”: browsers block navigator.geolocation entirely — use
       http://localhost:5173 on the PC, HTTPS, or the dev-only IP fallback in useUserLocation (LAN only). */
    host: true,
    /** Always use this port. If dev “moves” to 5174/5175, another process was still bound to 5173. */
    port: 5173,
    strictPort: true,
    /* Same-origin proxies in dev (NWS + RainViewer — avoids CORS / 429 error noise). */
    proxy: {
      "/weather-gov": {
        target: "https://api.weather.gov",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/weather-gov/, ""),
      },
      "/rainviewer-api": {
        target: "https://api.rainviewer.com",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/rainviewer-api/, ""),
      },
      "/rainviewer-tiles": rainViewerTileProxyOptions(),
    },
  },
  /** Same proxy as `server` — only applies if requests use `/weather-gov` (e.g. `VITE_NWS_API_BASE=/weather-gov`). */
  preview: {
    proxy: {
      "/weather-gov": {
        target: "https://api.weather.gov",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/weather-gov/, ""),
      },
      "/rainviewer-api": {
        target: "https://api.rainviewer.com",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/rainviewer-api/, ""),
      },
      "/rainviewer-tiles": rainViewerTileProxyOptions(),
    },
  },
});
