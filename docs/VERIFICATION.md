# Verification record

Checked on 4 November 2026 with Node 24.13.1 and Docker Engine 29.1.5.

- `npm ci`: completed from the pinned lockfile, including a fresh public HTTPS clone after publication.
- `npm run build`: TypeScript build passed.
- Local bootstrap: initialized a new PostgreSQL volume and a fresh Keycloak realm, separate from the recording's data. Alternate loopback ports avoided an already-running recording setup.
- `npm run setup:auth`: completed against that fresh realm. An additional assertion confirmed the helper rejects a non-loopback issuer before making a request.
- `npm test`: **16 passed, zero failures** through the public API/MCP interfaces; the fresh public clone also passed all 16 against the isolated development database.
- Combined local launcher: `/ready` returned HTTP 200 with `{"status":"ready"}` against the new database and identity service.
- `npm run stage:vercel`: produced two independent Express service roots; both TypeScript builds passed.
- `node --check auth0/post-login.cjs`: passed.
- All six application source files match the video project's source; hashes are recorded in `SOURCE-VERSION.json`.

The hosted recording previously verified Auth0 sign-in/refresh, a private ChatGPT read, Inspector reads/company isolation, and denial of a fresh sign-in without company metadata. That does not establish write-confirmation behavior in ChatGPT, compatibility with every client, load capacity, uptime or full disaster recovery.

This record states observations from the listed setup. Re-run the tests and target-host scenarios in your own environment.
