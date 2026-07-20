/**
 * StormPath home API for Forge (spare Windows PC).
 * Reuses Netlify function handlers; serves legal/ops static files from web/public.
 *
 * Listen: http://127.0.0.1:8787 (expose later via Cloudflare Tunnel).
 * Do not point TestFlight at this host until the tunnel is stable.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { handler as weatherkitHandler } from "../netlify/functions/weatherkit-token.ts";
import { handler as opsSummaryHandler } from "../netlify/functions/ops-summary.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.join(__dirname, ".env") });

const HOST = process.env.HOST?.trim() || "127.0.0.1";
const PORT = Number(process.env.PORT?.trim() || "8787");
const PUBLIC_DIR = path.resolve(__dirname, "../public");

type NetlifyResult = {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
};

type NetlifyHandler = (event: {
  httpMethod: string;
  headers?: Record<string, string | undefined>;
  queryStringParameters?: Record<string, string | undefined> | null;
}) => Promise<NetlifyResult>;

function collectHeaders(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") out[k] = v;
    else if (Array.isArray(v) && v[0]) out[k] = v[0];
  }
  return out;
}

async function invokeHandler(
  handler: NetlifyHandler,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL
): Promise<void> {
  const event = {
    httpMethod: req.method || "GET",
    headers: collectHeaders(req),
    queryStringParameters: Object.fromEntries(url.searchParams.entries()),
  };
  const result = await handler(event);
  res.writeHead(result.statusCode, result.headers ?? {});
  res.end(result.body);
}

function contentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".ico":
      return "image/x-icon";
    case ".txt":
      return "text/plain; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

async function serveStatic(
  res: ServerResponse,
  urlPath: string
): Promise<boolean> {
  let rel = decodeURIComponent(urlPath.split("?")[0] || "/");
  if (rel === "/") rel = "/index.html";
  if (rel.endsWith("/")) rel = `${rel}index.html`;

  const abs = path.resolve(PUBLIC_DIR, "." + rel);
  if (!abs.startsWith(PUBLIC_DIR + path.sep) && abs !== PUBLIC_DIR) {
    res.writeHead(403).end("Forbidden");
    return true;
  }

  try {
    const st = await stat(abs);
    if (!st.isFile()) return false;
    const body = await readFile(abs);
    res.writeHead(200, {
      "Content-Type": contentType(abs),
      "Cache-Control": "public, max-age=60",
    });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

function normalizeApiPath(pathname: string): string {
  if (pathname.startsWith("/stormpath/")) {
    return pathname.slice("/stormpath".length) || "/";
  }
  return pathname;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);
    const apiPath = normalizeApiPath(url.pathname);

    if (apiPath === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "stormpath-home-api" }));
      return;
    }

    if (apiPath === "/weatherkit-token") {
      await invokeHandler(weatherkitHandler, req, res, url);
      return;
    }

    if (apiPath === "/ops-summary") {
      await invokeHandler(opsSummaryHandler, req, res, url);
      return;
    }

    const served = await serveStatic(res, apiPath);
    if (!served) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "server error";
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: msg }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`StormPath home-api listening on http://${HOST}:${PORT}`);
  console.log(`  health:          http://${HOST}:${PORT}/health`);
  console.log(`  weatherkit:      http://${HOST}:${PORT}/weatherkit-token`);
  console.log(`  ops:             http://${HOST}:${PORT}/ops/`);
  console.log(`  ops-summary:     http://${HOST}:${PORT}/ops-summary`);
  console.log(`  (also /stormpath/* aliases)`);
});
