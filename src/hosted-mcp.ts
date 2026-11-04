import { z } from "zod";
import { createMcpApp } from "./mcp.js";

const config = z.object({
  MCP_URL: z.url(), API_URL: z.url(), OAUTH_ISSUER: z.url(),
  OAUTH_TENANT_CLAIM: z.url(), DELEGATION_SECRET: z.string().min(32),
}).parse(process.env);
const apiUrl = new URL(config.API_URL);
if (apiUrl.protocol !== "https:") throw new Error("The hosted API must use HTTPS");
const { app } = await createMcpApp({
  issuer: config.OAUTH_ISSUER, resource: new URL(config.MCP_URL), apiUrl,
  delegationSecret: new TextEncoder().encode(config.DELEGATION_SECRET),
  tenantClaim: config.OAUTH_TENANT_CLAIM, mode: "production",
});
app.get("/ready", async (_request, response) => {
  try {
    const result = await fetch(new URL("/ready", apiUrl), { signal: AbortSignal.timeout(5000) });
    response.status(result.ok ? 200 : 503).json({ status: result.ok ? "ready" : "unavailable" });
  } catch {
    response.status(503).json({ status: "unavailable" });
  }
});

export default app;
