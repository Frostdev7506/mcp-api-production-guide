import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { Pool } from "pg";
import { SignJWT } from "jose";
import { randomUUID } from "node:crypto";
import { createApi } from "../src/api.js";

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL });
const server = createServer(createApi({ pool, delegationSecret: new TextEncoder().encode("test-only-secret-with-at-least-32-bytes") }));
let base = "";
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP address");
  base = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await pool.end();
});

test("an unauthenticated caller cannot list support tickets", async () => {
  const response = await fetch(`${base}/tickets`);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "authentication_required" });
});

async function bearer(tenant: string, scopes = "tickets:read", subject = "maya") {
  const token = await new SignJWT({ tenant, scope: scopes })
    .setProtectedHeader({ alg: "HS256" }).setSubject(subject)
    .setIssuer("urn:mcp-support:adapter").setAudience("urn:mcp-support:api")
    .setIssuedAt().setExpirationTime("60s")
    .sign(new TextEncoder().encode("test-only-secret-with-at-least-32-bytes"));
  return { Authorization: `Bearer ${token}` };
}

test("Maya sees only her company's tickets", async () => {
  const response = await fetch(`${base}/tickets`, { headers: await bearer("acme") });
  assert.equal(response.status, 200);
  const result = await response.json();
  const ids = result.tickets.map((ticket: { id: string }) => ticket.id);
  assert.deepEqual(ids.slice(0, 3), ["T104", "T105", "T106"]);
  assert.equal(ids.includes("T204"), false);
});

test("Maya can read the checkout ticket, while another company cannot", async () => {
  const allowed = await fetch(`${base}/tickets/T104`, { headers: await bearer("acme") });
  assert.equal(allowed.status, 200);
  assert.equal((await allowed.json()).title, "Checkout fails on mobile");
  const denied = await fetch(`${base}/tickets/T104`, { headers: await bearer("northstar") });
  assert.equal(denied.status, 404);
  assert.deepEqual(await denied.json(), { error: "not_found" });
});

test("a writer can prepare an exact ticket preview without creating the ticket", async () => {
  const response = await fetch(`${base}/ticket-drafts`, {
    method: "POST", headers: { ...await bearer("acme", "tickets:read tickets:write"), "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Follow up on mobile checkout", description: "Ask the customer which browser was used.", priority: "normal" }),
  });
  assert.equal(response.status, 201);
  const draft = await response.json();
  assert.match(draft.draft_id, /^[a-f0-9-]{36}$/);
  assert.equal(draft.preview.title, "Follow up on mobile checkout");
  assert.equal(draft.ticket_id, undefined);
});

test("concurrent retries of one draft create a single retrievable ticket", async () => {
  const headers = { ...await bearer("acme", "tickets:read tickets:write"), "Content-Type": "application/json" };
  const draftResponse = await fetch(`${base}/ticket-drafts`, {
    method: "POST", headers, body: JSON.stringify({ title: "Confirmed mobile checkout follow-up", description: "Request the browser version.", priority: "high" }),
  });
  const { draft_id } = await draftResponse.json();
  const responses = await Promise.all([0, 1].map(() => fetch(`${base}/tickets`, {
    method: "POST", headers, body: JSON.stringify({ draft_id }),
  })));
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 201]);
  const results = await Promise.all(responses.map((response) => response.json()));
  assert.equal(results[0].ticket.id, results[1].ticket.id);
  const retrieved = await fetch(`${base}/tickets/${results[0].ticket.id}`, { headers });
  assert.equal((await retrieved.json()).title, "Confirmed mobile checkout follow-up");
  const foreignCommit = await fetch(`${base}/tickets`, {
    method: "POST", headers: { ...await bearer("northstar", "tickets:write"), "Content-Type": "application/json" }, body: JSON.stringify({ draft_id }),
  });
  assert.equal(foreignCommit.status, 404);
});

test("invalid filters and a model-supplied tenant are rejected", async () => {
  for (const query of ["limit=500", "status=unknown", "tenant=northstar"]) {
    const response = await fetch(`${base}/tickets?${query}`, { headers: await bearer("acme") });
    assert.equal(response.status, 400, query);
    assert.deepEqual(await response.json(), { error: "invalid_input" });
  }
});

test("a read-only caller cannot prepare or commit a ticket", async () => {
  for (const path of ["/ticket-drafts", "/tickets"]) {
    const response = await fetch(base + path, { method: "POST", headers: { ...await bearer("acme"), "Content-Type": "application/json" }, body: "{}" });
    assert.equal(response.status, 403);
  }
});

test("a caller exceeding the shared request budget is throttled", async () => {
  const limited = createServer(createApi({ pool, delegationSecret: new TextEncoder().encode("test-only-secret-with-at-least-32-bytes"), rateLimitPerMinute: 2 }));
  await new Promise<void>((resolve) => limited.listen(0, "127.0.0.1", resolve));
  try {
    const address = limited.address();
    if (!address || typeof address === "string") throw new Error("TCP expected");
    const headers = await bearer("acme", "tickets:read", randomUUID());
    const url = `http://127.0.0.1:${address.port}/tickets/T104`;
    assert.equal((await fetch(url, { headers })).status, 200);
    assert.equal((await fetch(url, { headers })).status, 200);
    const blocked = await fetch(url, { headers });
    assert.equal(blocked.status, 429);
    assert.ok(blocked.headers.has("retry-after"));
  } finally {
    await new Promise<void>((resolve) => limited.close(() => resolve()));
  }
});

// Public HTTP boundary: malformed requests must not be reported as backend outages.
test("malformed and oversized JSON return useful client errors", async () => {
  const headers = { ...await bearer("acme", "tickets:write"), "Content-Type": "application/json" };
  const malformed = await fetch(base + "/ticket-drafts", { method: "POST", headers, body: "{" });
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { error: "invalid_json" });
  const oversized = await fetch(base + "/ticket-drafts", { method: "POST", headers, body: JSON.stringify({ title: "Large", description: "x".repeat(18000) }) });
  assert.equal(oversized.status, 413);
  assert.deepEqual(await oversized.json(), { error: "request_too_large" });
});
