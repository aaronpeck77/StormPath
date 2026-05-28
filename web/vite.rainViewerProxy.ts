import type { ProxyOptions } from "vite";

/** 1×1 transparent PNG — Mapbox scales to 256×256 raster cells. */
const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

function sendTransparentTile(res: import("node:http").ServerResponse): void {
  if (res.writableEnded) return;
  res.writeHead(200, {
    "Content-Type": "image/png",
    "Cache-Control": "public, max-age=120",
  });
  res.end(TRANSPARENT_PNG);
}

/**
 * Dev/preview proxy for RainViewer tiles: upstream 4xx/5xx → HTTP 200 + empty tile.
 * Stops Mapbox + the browser from flooding the console with red 500 lines when RainViewer
 * rate-limits or a tile is out of coverage.
 */
export function rainViewerTileProxyOptions(): ProxyOptions {
  let lastSoftFailLogAt = 0;

  const logSoftFail = (detail: string) => {
    const now = Date.now();
    if (now - lastSoftFailLogAt < 45_000) return;
    lastSoftFailLogAt = now;
    console.warn(
      `[RainViewer dev proxy] ${detail} — serving a transparent tile so the debug console stays quiet.`
    );
  };

  return {
    target: "https://tilecache.rainviewer.com",
    changeOrigin: true,
    secure: true,
    timeout: 20_000,
    proxyTimeout: 20_000,
    rewrite: (path) => path.replace(/^\/rainviewer-tiles/, ""),
    selfHandleResponse: true,
    configure: (proxy) => {
      proxy.on("proxyRes", (proxyRes, _req, res) => {
        const code = proxyRes.statusCode ?? 500;
        if (code >= 400) {
          logSoftFail(`upstream HTTP ${code}`);
          sendTransparentTile(res);
          proxyRes.resume();
          return;
        }
        const headers = { ...proxyRes.headers };
        delete headers["transfer-encoding"];
        res.writeHead(code, headers);
        proxyRes.pipe(res);
      });
      proxy.on("error", (err, _req, res) => {
        if (res && "writeHead" in res && !res.headersSent) {
          logSoftFail(err instanceof Error ? err.message : "proxy error");
          sendTransparentTile(res as import("node:http").ServerResponse);
        }
      });
    },
  };
}
