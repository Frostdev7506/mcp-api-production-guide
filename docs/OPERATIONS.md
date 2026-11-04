# Operating limits and release checks

## Implemented here

- Strict input schemas; bounded list sizes and a 16 KiB request-body limit.
- Provider discovery, signature/issuer/audience/expiry validation and administrator-assigned company claims.
- Server/API scope checks and company-scoped SQL access.
- Separate 60-second adapter-to-API credentials; no OAuth-token passthrough.
- Five-second API-call deadlines, bounded database queries and conservative connection pools.
- Immutable expiring drafts, transactional commit, row locking and replay of the same draft.
- Health/readiness routes, structured logs without bearer-token bodies and graceful local shutdown.
- Versioned, checksum-verified migrations using a separate deployment identity.
- Pinned dependencies/container bases and a non-root container runtime.

## Limits you must resolve for your environment

The API enforces a PostgreSQL-backed fixed-window budget of 120 requests per verified company/user per minute by default. Instances sharing that database share the counter. This adds a database write per authenticated request; size the database accordingly and plan stale-counter retention. Add appropriate ingress limits for unauthenticated traffic and platform-wide overload. Configure platform request/concurrency limits and database connection budgets together. Load-test the full hosted path; a local API benchmark excludes the model, transport, TLS and network.

Company filters are enforced by application code in this example; do not describe them as a separate database row-level-security policy. Assess defense in depth for your own data and threat model. Configure internal API ingress, key/secret rotation, audit retention, monitoring and alert delivery. Do not log tokens or customer ticket descriptions.

The exact draft handle prevents changing a prepared payload, and a transaction prevents duplicate commits. It does not attest to human consent. The intended AI host must enforce confirmation; consequential actions should bind a server-side approval to the person and exact operation.

Ticket descriptions are untrusted content. They must not change permissions or instructions. Read-only annotations and tool instructions help a host choose behavior; neither replaces authorization.

The hosted reference uses three database connections per warm API instance. Many instances still multiply that total. Check the target pooler's limits and transaction compatibility. Test startup after idle, provider failures, database exhaustion, key rotation and recovery.

## Repeatable verification

```sh
npm ci
npm run setup:env
docker compose up -d --wait db
npm test
npm run stage:vercel
```

The integration suite uses the application database and isolated synthetic test identities. Run it against a disposable development database, never a real customer database. Review a complete run before a release. Build both staged service directories with `npm ci` then `npm run build` when changing hosted packaging.

Optional local benchmark, after building and with the fixture database running:

```sh
node --env-file=.env scripts/benchmark.mjs
```

Read its stated request count/concurrency. A number from this script is not a service-level objective.

## Container deployment

```sh
docker build -t mcp-support-reference:local .
```

The container runs the combined launcher. Inject runtime configuration privately; do not bake `.env` into an image. In production, give it HTTPS issuer/resource URLs and suitable ingress, readiness checks and network controls. The combined launcher uses the local `tenant_id` claim name; use a provider configured for that claim or adapt the entry point and test it before deploying. The Auth0/Vercel route uses the hosted entry with `OAUTH_TENANT_CLAIM` instead.

## Database changes and rollback

Set `MIGRATION_DATABASE_URL` only in the deployment job, then run `npm run migrate`. Do not grant runtime services DDL privileges. Never edit an already applied migration: add a new numbered file. Prefer backward-compatible changes before switching application versions. Keep the previous immutable application artifact and a tested backup.

Rolling back code does not undo a destructive schema change. Review data restoration separately. Never use volume deletion as a migration strategy.

## Backups

Use encrypted provider backups with access control and retention. Practice restoration to a **new, disposable database**, confirm T104 and application access, and measure recovery time. Include identity-provider configuration, Actions, client registrations and secret-recovery procedures in your recovery plan. A database-only restore is not a complete environment restore.

For a local snapshot:

```sh
mkdir -p backups
umask 077
docker compose exec -T db pg_dump -U postgres -Fc support > backups/support.dump
```

Keep backups out of Git. Use a unique database name for restore practice; never restore over a live database just to test a backup.

## Release gate

Record evidence for the actual host: successful and denied reads, confirmed/rejected writes, cancellation, replay, expired credentials/drafts, OAuth refresh/revocation, cold startup, failure recovery, shared quotas, alerts, restore and rollback. State exactly which clients and operations were tested. Private installation and public directory distribution have separate requirements.
