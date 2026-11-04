import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { before, after, test } from "node:test";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { Pool } from "pg";
import { createApi } from "../src/api.js";
import { createMcpApp } from "../src/mcp.js";

const secret = new TextEncoder().encode("mcp-test-delegation-secret-more-than-32-bytes");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const keys = await generateKeyPair("RS256");
const jwk = { ...await exportJWK(keys.publicKey), kid: "fixture-key", alg: "RS256", use: "sig" };
const servers: Server[] = [];
let issuer = "";
let base = "";
let closeMcp: () => Promise<void>;
const resource = new URL("http://127.0.0.1:4311/mcp");
async function listen(server: Server) {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("TCP server expected");
  return `http://127.0.0.1:${address.port}`;
}
before(async () => {
  issuer = await listen(createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/hosted/.well-known/openid-configuration") {
      response.end(JSON.stringify({
        issuer: issuer + "/hosted/", authorization_endpoint: issuer + "/authorize", token_endpoint: issuer + "/token",
        jwks_uri: issuer + "/jwks", response_types_supported: ["code"], code_challenge_methods_supported: ["S256"],
      }));
      return;
    }
    if (request.url !== "/jwks" && request.url !== "/.well-known/openid-configuration") {
      response.statusCode = 404;
      response.end("{}");
      return;
    }
    response.end(JSON.stringify(request.url === "/jwks" ? { keys: [jwk] } : {
      issuer, authorization_endpoint: issuer + "/authorize", token_endpoint: issuer + "/token",
      jwks_uri: issuer + "/jwks", response_types_supported: ["code"], code_challenge_methods_supported: ["S256"],
      client_id_metadata_document_supported: true, token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
    }));
  }));
  const api = await listen(createServer(createApi({ pool, delegationSecret: secret })));
  const mcp = await createMcpApp({ issuer, resource, apiUrl: new URL(api), delegationSecret: secret, mode: "local" });
  closeMcp = mcp.close;
  base = await listen(createServer(mcp.app));
});
after(async () => {
  if (closeMcp) await closeMcp();
  for (const server of servers.reverse()) await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});
async function token(audience = resource.href, tenant = "acme", scope = "tickets:read tickets:write") {
  return new SignJWT({ tenant_id: tenant, scope, azp: "test-host" }).setProtectedHeader({ alg: "RS256", kid: "fixture-key" })
    .setIssuer(issuer).setSubject("maya-mcp").setAudience(audience).setIssuedAt().setExpirationTime("5m").sign(keys.privateKey);
}
async function rpc(method: string, params: Record<string, unknown>, authorization?: string, endpoint = base) {
  return fetch(endpoint + "/mcp", {
    method: "POST", headers: {
      "content-type": "application/json", accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": method,
      ...(typeof params.name === "string" ? { "Mcp-Name": params.name } : {}),
      ...(authorization ? { authorization: `Bearer ${authorization}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: {
      ...params, _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientInfo": { name: "test-host", version: "1.0.0" },
        "io.modelcontextprotocol/clientCapabilities": {},
      },
    } }),
  });
}

test("the MCP endpoint advertises its auth resource and rejects an unissued token", async () => {
  const missing = await rpc("tools/list", {});
  assert.equal(missing.status, 401);
  assert.match(missing.headers.get("www-authenticate") ?? "", /resource_metadata/);
  const wrongAudience = await rpc("tools/list", {}, await token("urn:another-api"));
  assert.equal(wrongAudience.status, 401);
  const response = await fetch(base + "/.well-known/oauth-protected-resource/mcp");
  assert.equal(response.status, 200);
  const metadata = await response.json();
  assert.equal(metadata.resource, resource.href);
  assert.deepEqual(metadata.authorization_servers, [issuer]);
});

test("an authenticated MCP call reads the actual permitted API ticket", async () => {
  const response = await rpc("tools/call", { name: "get_ticket", arguments: { id: "T104" } }, await token());
  assert.equal(response.status, 200, await response.clone().text());
  const result = await response.json();
  assert.equal(result.result.structuredContent.title, "Checkout fails on mobile");
});

test("OAuth discovery preserves the provider's CIMD client registration support", async () => {
  const response = await fetch(base + "/.well-known/oauth-authorization-server");
  assert.equal(response.status, 200);
  const metadata = await response.json();
  assert.equal(metadata.client_id_metadata_document_supported, true);
  assert.deepEqual(metadata.token_endpoint_auth_methods_supported, ["none", "private_key_jwt"]);
});

test("MCP cannot use a valid token to cross the ticket's company boundary", async () => {
  const response = await rpc("tools/call", { name: "get_ticket", arguments: { id: "T104" } }, await token(resource.href, "northstar"));
  const body = await response.json();
  assert.equal(body.result.isError, true);
  assert.deepEqual(JSON.parse(body.result.content[0].text), { error: "not_found" });
});

test("read-only MCP access cannot prepare a write", async () => {
  const response = await rpc("tools/call", { name: "prepare_ticket", arguments: { title: "Attempted write", description: "This must not become a draft.", priority: "normal" } }, await token(resource.href, "acme", "tickets:read"));
  const body = await response.json();
  assert.equal(body.result.isError, true);
  assert.deepEqual(JSON.parse(body.result.content[0].text), { error: "insufficient_scope" });
});

test("a malicious browser origin is rejected before tool execution", async () => {
  const response = await fetch(base + "/mcp", { method: "POST", headers: { Origin: "https://untrusted.example", "Content-Type": "application/json" }, body: "{}" });
  assert.equal(response.status, 403);
});

test("hosted OAuth accepts its namespaced company claim and rejects an unconfigured claim", async () => {
  const tenantClaim = "https://support-demo.example/tenant_id";
  const hostedIssuer = issuer + "/hosted/";
  const hostedOptions = { issuer: hostedIssuer, resource, apiUrl: new URL("http://127.0.0.1"), delegationSecret: secret, mode: "local" as const, tenantClaim };
  const hosted = await createMcpApp(hostedOptions);
  const endpoint = await listen(createServer(hosted.app));
  const credential = (claims: Record<string, string>) => new SignJWT({ ...claims, scope: "tickets:read", azp: "hosted-client" })
    .setProtectedHeader({ alg: "RS256", kid: "fixture-key" }).setIssuer(hostedIssuer)
    .setSubject("maya-hosted").setAudience(resource.href).setIssuedAt().setExpirationTime("5m").sign(keys.privateKey);
  try {
    const accepted = await rpc("tools/list", {}, await credential({ [tenantClaim]: "acme" }), endpoint);
    assert.equal(accepted.status, 200, await accepted.clone().text());
    const result = await accepted.json();
    assert.deepEqual(result.result.tools.map((tool: { name: string }) => tool.name), ["list_tickets", "get_ticket", "prepare_ticket", "create_ticket"]);
    const rejected = await rpc("tools/list", {}, await credential({ tenant_id: "acme" }), endpoint);
    assert.equal(rejected.status, 401);
  } finally {
    await hosted.close();
  }
});
