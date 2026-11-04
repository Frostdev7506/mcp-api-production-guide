# Deploy your own hosted example

The recording uses two Vercel Express services, Neon PostgreSQL and an isolated Auth0 tenant. Follow this after the local walkthrough works. Use your own resources and secrets. Free-plan availability and limits can change; check the providers before creating resources. No paid plan is necessary for the demonstrated workload.

This guide reproduces the architecture. Account ownership, consent and client-registration screens may differ from the recording. Never copy the creator's account identifiers or use the creator's deployed endpoint as your own backend.

## 1. Create the database and restricted role

Create a PostgreSQL database with TLS. Keep its owner connection string in a deployment secret store as `MIGRATION_DATABASE_URL`. Using an administrator SQL session, create a login role named `support_app` with a new random password, without superuser, create-database or create-role permissions. The migration grants runtime access to this role; it must exist first.

```sql
CREATE ROLE support_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
```

Set its password through the provider's secure role UI or your password-management process. Do not put it in a committed SQL file. Run the migration with the DDL-capable owner URL supplied through the shell's environment or a secrets manager:

```sh
npm run migrate
```

Run it twice: the first run applies `001-ticket-schema.sql`; the second reports zero new migrations. The migration checksums applied files and takes a transaction advisory lock. Load `infra/seed-local.sql` through the owner connection only if this is an isolated synthetic demonstration database. Do not seed real customer data.

Create a TLS connection string for `support_app`; this becomes the API service's `DATABASE_URL`. Hosted API code enforces `sslmode=verify-full`. Do not switch certificate verification off to resolve a connection problem.

## 2. Reserve your service URLs

Create two free Vercel projects, one API and one MCP service. Reserve their final HTTPS hostnames. For example:

- API: `https://YOUR_API_HOST`
- MCP resource: `https://YOUR_MCP_HOST/mcp`

The full MCP URL is the OAuth audience/resource identifier. Keep it exact throughout configuration. Generate a separate random delegation secret of at least 32 bytes; supply the same value to these two services only.

```sh
npm run stage:vercel
```

This creates ignored `.deploy/api` and `.deploy/mcp` directories with explicit source allowlists and Express entry points. Each directory is an independent deployment root. Use the official Vercel dashboard/CLI to link and deploy each root. Do not deploy the repository root or commit platform tokens. The `.deploy` source needs no Docker container on Vercel.

## 3. Configure an isolated Auth0 tenant

Create an API/resource server whose identifier is your exact HTTPS MCP URL, with RS256 signing and scopes `tickets:read` and `tickets:write`. Use a short access-token lifetime; the recording used 900 seconds. Obtain the exact issuer URL, normally ending in `/`.

Use a dedicated synthetic database connection. Create your own demo users with private, unique passwords. Assign Maya `app_metadata: {"tenant_id":"acme"}` and a second user `{"tenant_id":"northstar"}` through an administrator-controlled process. A user must not be able to edit this company assignment.

Edit the two constants in `auth0/post-login.cjs`:

- `MCP_RESOURCE`: your exact HTTPS MCP resource/audience.
- `TENANT_CLAIM`: a URL namespace you control, for example `https://YOUR_MCP_HOST/tenant_id`.

Deploy the Action and bind it to the Login flow. It adds the company claim only for this resource and refuses that resource's login if the company assignment is missing or invalid. Use the same claim name in the MCP service environment.

Register each intended OAuth client separately. The recorded Inspector client was public/native with PKCE and an exact loopback `/oauth/callback`. Use the actual callback shown by your Inspector; no wildcards. Grant only the two user-delegated ticket scopes needed for the demo. Do not grant the Auth0 Management API or a machine-to-machine substitute for user access.

The ChatGPT demo used a manually registered official client ID metadata document (CIMD), with dynamic registration disabled. Configure this using the [current official ChatGPT authentication instructions](https://developers.openai.com/plugins/build/auth) and your provider's supported flow. Verify official metadata, callback and key URLs from those instructions. Do not paste a made-up client ID, use another application's client secret, or assume every provider supports CIMD.

For an isolated Auth0 third-party/CIMD setup, the synthetic database connection may need domain-level availability. That makes the connection eligible for other third-party applications in that tenant, including future registrations. Evaluate that tenant-wide setting before enabling it; do not apply it casually to a tenant holding real users. Do not enable unrelated social connections. The recording used this setting only for its isolated synthetic tenant.

If refresh access is needed, enable bounded, rotating refresh tokens for the specific clients, explicit consent and revocation. The recorded policy was 24-hour idle / seven-day maximum, with a ten-second rotation overlap. Confirm current provider capabilities; do not use unlimited offline access as a shortcut.

## 4. Set each service's environment

Use the platform secret store, not public build-time variables or committed env files.

| Service | Variable | Value |
| --- | --- | --- |
| API | `DATABASE_URL` | Restricted `support_app` PostgreSQL TLS URL |
| API | `DELEGATION_SECRET` | Random shared adapter/API secret |
| MCP | `DELEGATION_SECRET` | Same secret |
| MCP | `API_URL` | Your HTTPS API origin |
| MCP | `MCP_URL` | Your full HTTPS MCP resource URL |
| MCP | `OAUTH_ISSUER` | Exact Auth0 issuer, including trailing slash |
| MCP | `OAUTH_TENANT_CLAIM` | Same namespaced claim as the Action |

Deploy the API first, then MCP. `src/hosted-api.ts` and `src/hosted-mcp.ts` are the hosted entry modules. The local combined launcher uses a different configuration and is not the Vercel entry.

The API URL is publicly reachable in this free example, but ticket routes require the adapter's separate, 60-second credential. The external OAuth token is never passed through. For a real service, add appropriate network restrictions or authenticated internal ingress and test them; a secret URL alone is not access control.

## 5. Verify before connecting an assistant

Check both services' `/health` and `/ready`. Fetch OAuth protected-resource metadata at `https://YOUR_MCP_HOST/.well-known/oauth-protected-resource/mcp` and verify its exact resource and authorization-server values. Check the provider's discovery and keys.

Connect Inspector to your HTTPS `/mcp` endpoint using the registered hosted client. Exercise:

1. Fresh login and refresh-token rotation.
2. A successful Acme T104 read.
3. A denied cross-company T204 read.
4. Missing-company sign-in denial, then restored assignment and fresh successful sign-in.
5. Prepare → show preview → confirm → create → same-handle retry.
6. Timeout, insufficient-scope and expired-draft responses.

Do not publish access tokens, authorization codes, cookies or database URLs in a recording or issue report.

## 6. Add a private ChatGPT connection

Use [OpenAI's current connection guide](https://developers.openai.com/plugins/deploy/connect-chatgpt). Account/workspace policies control availability. Add the HTTPS MCP URL, configure OAuth and review discovered tools. Sign in as the synthetic user. Ask for T104 and compare the selected tool's actual input/result with Inspector.

Test writes separately, including a rejected confirmation, cancellation and retry. The recording verified a private ChatGPT **read** and provider sign-in/refresh; it did not verify ChatGPT's write-confirmation behavior. Keep writes disabled in any real rollout until that behavior is proven.

A private custom connection is not a public listing. [Public plugin submission](https://developers.openai.com/plugins/deploy/submission) is a separate packaging/review/publication process. A listing can offer discovery; it does not guarantee installs, users, model selection or faster API performance.

## 7. Complete launch evidence

Use [Operations](OPERATIONS.md). This example's free deployments are educational resources. They do not establish an availability commitment, a production capacity estimate or a complete security assessment.
