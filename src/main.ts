import { createServer, type Server } from "node:http";
import { Pool } from "pg";
import { z } from "zod";
import { createApi } from "./api.js";
import { createMcpApp } from "./mcp.js";

const config = z.object({
  DATABASE_URL: z.string().min(1), DELEGATION_SECRET: z.string().min(32),
  API_URL: z.url(), MCP_URL: z.url(), OAUTH_ISSUER: z.url(),
  APP_MODE: z.enum(["local", "production"]),
}).parse(process.env);
const apiUrl = new URL(config.API_URL);
const resource = new URL(config.MCP_URL);
const pool = new Pool({
  connectionString: config.DATABASE_URL, max: 10,
  connectionTimeoutMillis: 2000, idleTimeoutMillis: 10000,
  statement_timeout: 3000, query_timeout: 4000,
});
pool.on("error", () => console.error(JSON.stringify({ event: "database_connection_error" })));
const secret = new TextEncoder().encode(config.DELEGATION_SECRET);
const api = createApi({ pool, delegationSecret: secret });
const apiServer = createServer(api);
const boundHost = config.APP_MODE === "local" ? "127.0.0.1" : "0.0.0.0";
const port = (url: URL, fallback: number) => Number(url.port || fallback);
async function listen(server: Server, at: number) {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(at, boundHost, resolve);
  });
}
await listen(apiServer, port(apiUrl, 4310));
const mcp = await createMcpApp({ issuer: config.OAUTH_ISSUER, resource, apiUrl, delegationSecret: secret, mode: config.APP_MODE });
mcp.app.get("/ready", async (_request, response) => {
  try {
    const ready = await fetch(new URL("/ready", apiUrl), { signal: AbortSignal.timeout(2000) });
    response.status(ready.ok ? 200 : 503).json({ status: ready.ok ? "ready" : "unavailable" });
  } catch { response.status(503).json({ status: "unavailable" }); }
});
const mcpServer = createServer(mcp.app);
mcpServer.on("request", (request, response) => {
  const began = performance.now();
  response.once("finish", () => {
    console.log(JSON.stringify({ event: "mcp_request", method: request.method, status: response.statusCode, duration_ms: Math.round(performance.now() - began) }));
  });
});
await listen(mcpServer, port(resource, 4311));
console.log(JSON.stringify({ event: "ready", api: apiUrl.origin, mcp: resource.href, mode: config.APP_MODE }));
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => process.exit(1), 8000);
  deadline.unref();
  await Promise.all([apiServer, mcpServer].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await mcp.close();
  await pool.end();
  clearTimeout(deadline);
}
process.once("SIGTERM", () => void stop());
process.once("SIGINT", () => void stop());
