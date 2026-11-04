# Troubleshooting

| Symptom | Check |
| --- | --- |
| `npm ci` rejects the engine | Use Node 24.x; keep the lockfile and pinned SDK packages together. |
| Docker connection fails | Start Docker, then run `docker compose version` and `docker info`. |
| A port is occupied | Stop the other tutorial instance first. The default compose project and ports are documented in README. Do not remove its volumes. |
| Keycloak setup times out | `docker compose logs --tail 80 auth`. Confirm the database is healthy, then rerun `npm run setup:auth`. First image downloads take time. |
| Database password authentication fails | The volume may have been initialized with another `.env`. Restore that original environment or use a separate Compose project and ports. Changing env values does not change existing database passwords. |
| `Issuer discovery mismatch` | Copy the exact provider issuer, including its path and trailing slash. Local issuer has no trailing slash; Auth0 normally has one. |
| OAuth callback rejected | Match the Inspector launcher's actual origin and `/oauth/callback` exactly to a registered callback. Default launcher callbacks use localhost:6274; this fixture also registers 127.0.0.1:6274 and :6276. Do not use wildcard callbacks. |
| Inspector proxy rejects access | Open the launcher's complete local URL. Keep the proxy-session credential private; do not disable proxy authentication. |
| Browser reuses another user | End the provider session, then reconnect and select the intended fixture. |
| `insufficient_scope` | Request the needed `tickets:read` or `tickets:write` scope, review consent, and sign in again for a fresh token. |
| Cross-company `not_found` | Expected. Maya cannot read T204; Sam cannot read T104. Never fix this by trusting a company ID from tool arguments. |
| Missing-company sign-in fails | Assign the synthetic user's company through admin-only metadata/mappers. Do not create a fallback company. |
| `draft_expired` | Prepare again, show the new preview and obtain confirmation for the new handle. |
| A write times out | Do not assume it failed. Retry the same confirmed draft handle and inspect the returned ID/replay flag. |
| `backend_unavailable` | Check API `/ready`, DB connectivity and the exact HTTPS API URL. Investigate logs; do not infer that a first timeout is always a cold start. |
| Host rejects a nullable output schema | This server declares `next_cursor` as string or null. Test your target host's schema dialect before release; the recorded hosts accepted it, but host compatibility varies. |
| Hosted Express entry not detected | Use `npm run stage:vercel`; each staged entry directly imports Express and exports the mounted app. |

Logs can contain identifiers. Redact credentials, authorization headers, database URLs and customer content before sharing an issue. Include Node/Docker versions, the command, error code and the relevant non-secret configuration names.
