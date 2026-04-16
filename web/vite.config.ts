import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const pkgPath = fileURLToPath(new URL("./package.json", import.meta.url));
const { version: appVersion } = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version: string };

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "mapbox-gl": ["mapbox-gl"],
        },
      },
    },
  },
  server: {
    /* Lets you open the dev URL from your phone on the same Wi‑Fi (e.g. http://192.168.x.x:5173).
       Geolocation on that URL still needs HTTPS — use your deployed build or a local HTTPS proxy. */
    host: true,
    /** Always use this port. If dev “moves” to 5174/5175, another process was still bound to 5173. */
    port: 5173,
    strictPort: true,
    /* Same-origin NWS fetches in dev (avoids CORS when testing from phone on LAN). */
    proxy: {
      "/weather-gov": {
        target: "https://api.weather.gov",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/weather-gov/, ""),
      },
    },
  },
});
