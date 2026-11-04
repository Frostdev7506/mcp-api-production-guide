/** Configure only the isolated tutorial realm. */
import { readFile } from "node:fs/promises";
import { z } from "zod";
const issuer = new URL(z.url().parse(process.env.OAUTH_ISSUER));
if (issuer.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(issuer.hostname) || issuer.pathname !== "/realms/support-demo") {
  throw new Error("This helper configures only the loopback support-demo realm");
}
const root = issuer.origin;
// A fresh Keycloak container may take a minute to import its realm.
for (let attempt = 0; ; attempt++) {
  try {
    const ready = await fetch(issuer.href + "/.well-known/openid-configuration", { signal: AbortSignal.timeout(3000) });
    if (ready.ok) break;
  } catch { /* Retry only the bounded local startup check. */ }
  if (attempt >= 39) throw new Error("Keycloak did not become ready; inspect docker compose logs auth");
  await new Promise(resolve => setTimeout(resolve, 3000));
}
const password = z.string().min(1).parse(process.env.KEYCLOAK_ADMIN_PASSWORD);
const login = await fetch(root + "/realms/master/protocol/openid-connect/token", {
  method: "POST", body: new URLSearchParams({ grant_type: "password", client_id: "admin-cli", username: "tutorial-admin", password }),
  signal: AbortSignal.timeout(5000),
});
if (!login.ok) throw new Error("Tutorial identity admin login failed");
const { access_token } = z.object({ access_token: z.string() }).parse(await login.json());
const headers = { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" };
const clients = await fetch(root + "/admin/realms/support-demo/clients?clientId=support-inspector", { headers, signal: AbortSignal.timeout(5000) });
const matches = z.array(z.object({ id: z.string() })).min(1).parse(await clients.json());
const id = matches[0]!.id;
const realm = JSON.parse(await readFile(new URL("../infra/support-demo-realm.json", import.meta.url), "utf8"));
const client = realm.clients[0];
client.redirectUris = ["http://localhost:6274/oauth/callback", "http://127.0.0.1:6274/oauth/callback", "http://127.0.0.1:6276/oauth/callback"];
client.webOrigins = ["http://localhost:6274", "http://127.0.0.1:6274"];
client.optionalClientScopes = ["tickets:write", "offline_access"];
client.consentRequired = true;
const result = await fetch(root + "/admin/realms/support-demo/clients/" + id, {
  method: "PUT", headers, body: JSON.stringify({ ...client, id }), signal: AbortSignal.timeout(5000),
});
if (!result.ok) throw new Error("Tutorial static-client configuration failed: " + result.status);
const scopesResponse = await fetch(root + "/admin/realms/support-demo/client-scopes", { headers });
const scopes = z.array(z.object({ id: z.string(), name: z.string() })).parse(await scopesResponse.json());
for (const [name, kind] of [["tickets:read", "default"], ["tickets:write", "optional"], ["offline_access", "optional"], ["basic", "default"]] as const) {
  let scope = scopes.find((entry) => entry.name === name);
  if (!scope) {
    const made = await fetch(root + "/admin/realms/support-demo/client-scopes", { method: "POST", headers, body: JSON.stringify({ name, protocol: "openid-connect", attributes: { "include.in.token.scope": name === "basic" ? "false" : "true", "display.on.consent.screen": name === "basic" ? "false" : "true" }, ...(name === "basic" ? { protocolMappers: [{ name: "Subject (sub)", protocol: "openid-connect", protocolMapper: "oidc-sub-mapper", config: { "access.token.claim": "true", "introspection.token.claim": "true", "lightweight.claim": "false" } }] } : {}) }) });
    if (!made.ok) throw new Error("Scope creation failed: " + name);
    const reloaded = await fetch(root + "/admin/realms/support-demo/client-scopes", { headers });
    scope = z.array(z.object({ id: z.string(), name: z.string() })).parse(await reloaded.json()).find((entry) => entry.name === name);
  }
  if (!scope) throw new Error("Required scope unavailable: " + name);
  const assigned = await fetch(`${root}/admin/realms/support-demo/clients/${id}/${kind}-client-scopes/${scope.id}`, { method: "PUT", headers });
  if (!assigned.ok) throw new Error("Scope assignment failed: " + name);
}
let roleResponse = await fetch(root + "/admin/realms/support-demo/roles/offline_access", { headers });
if (roleResponse.status === 404) {
  const created = await fetch(root + "/admin/realms/support-demo/roles", { method: "POST", headers, body: JSON.stringify({ name: "offline_access" }) });
  if (!created.ok) throw new Error("Offline access role setup failed");
  roleResponse = await fetch(root + "/admin/realms/support-demo/roles/offline_access", { headers });
}
const offlineRole = z.object({ id: z.string(), name: z.string() }).parse(await roleResponse.json());
for (const username of ["maya", "sam"]) {
  const usersResponse = await fetch(`${root}/admin/realms/support-demo/users?username=${username}&exact=true`, { headers });
  const users = z.array(z.object({ id: z.string() })).min(1).parse(await usersResponse.json());
  const assigned = await fetch(`${root}/admin/realms/support-demo/users/${users[0]!.id}/role-mappings/realm`, { method: "POST", headers, body: JSON.stringify([offlineRole]) });
  if (!assigned.ok) throw new Error("Tutorial user role assignment failed");
}
const mappingsResponse = await fetch(`${root}/admin/realms/support-demo/clients/${id}/protocol-mappers/models`, { headers });
const mappings = z.array(z.object({ id: z.string(), name: z.string() })).parse(await mappingsResponse.json());
for (const desired of client.protocolMappers) {
  const existing = mappings.find((mapping) => mapping.name === desired.name);
  const saved = await fetch(`${root}/admin/realms/support-demo/clients/${id}/protocol-mappers/models${existing ? "/" + existing.id : ""}`, {
    method: existing ? "PUT" : "POST", headers, body: JSON.stringify(existing ? { ...desired, id: existing.id } : desired),
  });
  if (!saved.ok) throw new Error("Tutorial claim mapper setup failed: " + desired.name);
}
const profileResponse = await fetch(root + "/admin/realms/support-demo/users/profile", { headers });
const profile = await profileResponse.json();
profile.attributes = [...profile.attributes.filter((attribute: { name: string }) => attribute.name !== "tenant_id"), {
 name: "tenant_id", displayName: "Company", multivalued: false,
 permissions: { view: ["admin"], edit: ["admin"] },
 validations: { length: { min: 1, max: 64 }, pattern: { pattern: "^[a-z][a-z0-9-]{0,63}$" } },
}];
const profileSaved = await fetch(root + "/admin/realms/support-demo/users/profile", { method: "PUT", headers, body: JSON.stringify(profile) });
if (!profileSaved.ok) throw new Error("Admin-only company attribute setup failed");
for (const [username, tenant] of [["maya", "acme"], ["sam", "northstar"]] as const) {
 const usersResponse = await fetch(`${root}/admin/realms/support-demo/users?username=${username}&exact=true`, { headers });
 const users = z.array(z.object({ id: z.string() })).min(1).parse(await usersResponse.json());
 const userUrl = `${root}/admin/realms/support-demo/users/${users[0]!.id}`;
 const details = await (await fetch(userUrl, { headers })).json();
 const saved = await fetch(userUrl, { method: "PUT", headers, body: JSON.stringify({ ...details, attributes: { ...details.attributes, tenant_id: [tenant] } }) });
 if (!saved.ok) throw new Error("Sample company assignment failed");
 const verified = await (await fetch(userUrl, { headers })).json();
 if (verified.attributes?.tenant_id?.[0] !== tenant) throw new Error("Sample company assignment did not persist");
 console.log(JSON.stringify({ sample_user: username, admin_managed_tenant_verified: true }));
}
console.log("Configured static OAuth, callbacks, scopes, refresh permissions and claim mappers.");
