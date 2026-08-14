import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
/* `vitest/config` re-exports `defineConfig` with the `test` option typed; the runtime config
 * is identical to `vite`'s, so dev/build are unaffected when Vitest isn't installed. */
import { loadEnv } from "vite";
import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";
import { rainViewerTileProxyOptions } from "./vite.rainViewerProxy";

const webRoot = fileURLToPath(new URL(".", import.meta.url));
const pkgPath = fileURLToPath(new URL("./package.json", import.meta.url));
const { version: appVersion } = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version: string };

function flavorStamps(command: string, mode: string) {
  const env = loadEnv(mode, webRoot, "");
  const flavor = command === "serve" ? "dev" : mode === "testflight" ? "testflight" : "appstore";
  const plusForced = ["plus", "pro"].includes((env.VITE_PAY_TIER || "").toLowerCase());
  const testPanel = (env.VITE_PAY_TIER_TEST_PANEL || "").toLowerCase() === "true";
  const admobTest = (env.VITE_ADMOB_TEST_MODE || "").toLowerCase() === "true";
  return {
    __STORMPATH_FLAVOR_STAMP__: JSON.stringify(
      flavor === "testflight"
        ? "STORMPATH_FLAVOR_STAMP_testflight"
        : flavor === "dev"
          ? "STORMPATH_FLAVOR_STAMP_dev"
          : "STORMPATH_FLAVOR_STAMP_appstore"
    ),
    __STORMPATH_PLUS_FORCED_STAMP__: JSON.stringify(
      plusForced ? "STORMPATH_PLUS_FORCED_yes" : "STORMPATH_PLUS_FORCED_no"
    ),
    __STORMPATH_TEST_PANEL_STAMP__: JSON.stringify(
      testPanel ? "STORMPATH_TEST_PANEL_yes" : "STORMPATH_TEST_PANEL_no"
    ),
    __STORMPATH_ADMOB_TEST_STAMP__: JSON.stringify(
      admobTest ? "STORMPATH_ADMOB_TEST_yes" : "STORMPATH_ADMOB_TEST_no"
    ),
  };
}

/**
 * Vite's SPA fallback serves the React app for `/ops` and `/ops/`. Rewrite those to the
 * static Control Room page in `public/ops/index.html` (which already works when requested
 * by full filename).
 */
function stormpathOpsHubPlugin(): Plugin {
  const rewrite = (
    req: { url?: string },
    _res: unknown,
    next: () => void
  ) => {
    const path = req.url?.split("?")[0] ?? "";
    if (path === "/ops" || path === "/ops/") {
      req.url = "/ops/index.html";
    }
    next();
  };
  return {
    name: "stormpath-ops-hub",
    configureServer(server) {
      server.middlewares.use(rewrite);
    },
    configurePreviewServer(server) {
      server.middlewares.use(rewrite);
    },
  };
}

export default defineConfig(({ command, mode }) => ({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    ...flavorStamps(command, mode),
  },
  plugins: [
    stormpathOpsHubPlugin(),
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
    /* Live NWS fetches are flaky in CI — run them locally via `npm run test:integration`. */
    exclude: process.env.CI ? ["src/**/*.integration.test.ts"] : [],
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
    /* Phase 8.x — BUILD-ONLY alias. Redirect the bare `mapbox-gl` specifier to the
     * CSP-friendly build for production bundles (which run on Capacitor's
     * capacitor://localhost origin where blob: workers are silently rejected by
     * WebKit). The CSP build is UMD-formatted and Vite dev can't serve UMD as ESM —
     * dev mode would throw "Cannot use import statement outside a module" — so dev
     * keeps using the default ESM build (which works fine on http://localhost:5173).
     * Symptom this fixes on TestFlight 122: TileJSON fetches succeed (req=11), style
     * + layers parse (137 layers), but `tilesLoaded=n` forever because workers never
     * decode the vector tile data — silent worker-spawn failure under WebKit CSP.
     * The CSP build loads its worker from an explicit same-origin /assets/ URL
     * (see `mapboxgl.workerUrl =` setup in DriveMap.tsx). */
    alias: command === "build"
      ? [{ find: /^mapbox-gl$/, replacement: "mapbox-gl/dist/mapbox-gl-csp" }]
      : [],
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
    /* Same-origin proxies in dev (NWS + RainViewer + WeatherKit — avoids CORS / 429 error noise). */
    proxy: {
      "/weather-gov": {
        target: "https://api.weather.gov",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/weather-gov/, ""),
      },
      /* Apple WeatherKit REST API rejects CORS preflights from localhost.
       * Route through the dev server so the request originates from Node, not the browser. */
      "/weatherkit-api": {
        target: "https://weatherkit.apple.com",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/weatherkit-api/, ""),
      },
      "/rainviewer-api": {
        target: "https://api.rainviewer.com",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/rainviewer-api/, ""),
      },
      "/rainviewer-tiles": rainViewerTileProxyOptions(),
      "/tomorrow-io-tiles": {
        target: "https://api.tomorrow.io",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/tomorrow-io-tiles/, "/v4/map/tile"),
      },
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
      "/weatherkit-api": {
        target: "https://weatherkit.apple.com",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/weatherkit-api/, ""),
      },
      "/rainviewer-api": {
        target: "https://api.rainviewer.com",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/rainviewer-api/, ""),
      },
      "/rainviewer-tiles": rainViewerTileProxyOptions(),
      "/tomorrow-io-tiles": {
        target: "https://api.tomorrow.io",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/tomorrow-io-tiles/, "/v4/map/tile"),
      },
    },
  },
}));
