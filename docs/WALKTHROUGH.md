# Follow the video

Use the README's local setup first. Every example below uses the same synthetic support product and Maya's Acme account.

## 1. Read, then check the boundary

Call `list_tickets` with `{"status":"open","limit":2}`. The fresh fixture returns T104 and T105 and `next_cursor: "VDEwNQ"`. Pass that cursor on the next list call when you need another page. A changed database may return different results.

Call `get_ticket` with `{"id":"T104"}`. Read the actual description. Call it again with `{"id":"T204"}`. Maya must receive `not_found`; the API must not reveal another company's ticket.

Sign out and sign in as Sam to check the reverse boundary: Sam can read Northstar's T204, and cannot read Acme's T104. Use the same registered callback and clear the previous provider session when switching accounts.

## 2. Prepare a write

Call `prepare_ticket` with:

```json
{
  "title": "Follow up on mobile checkout",
  "description": "Ask the customer which browser was used.",
  "priority": "normal"
}
```

This stores an expiring draft, not a ticket. It returns `draft_id` and `preview`. Read the preview and explicitly approve that exact content before the next call. Keep the returned handle; do not substitute an example UUID from documentation.

## 3. Commit, then retry

Call `create_ticket` with `{"draft_id":"<the actual returned UUID>"}`. Expect a ticket and `replayed: false` on its first successful commit. The generated ticket ID depends on previous runs.

Repeat the exact same call. Expect the same ticket ID and `replayed: true`. A row lock and transaction let concurrent retries reuse one committed result. A new draft represents a new proposed action. Uncommitted drafts expire after ten minutes.

The opaque draft handle and tool descriptions do **not** prove a person approved the action. The host must obtain and enforce confirmation. For more consequential writes, use an application approval record bound to the user, exact payload, expiry and action. Test rejection and cancellation in the actual host.

## 4. Follow one request in the source

1. `mcp.ts` declares the tool's schema and forwards only validated arguments.
2. `auth.ts` verifies the provider's signature, issuer, audience, expiry and company claim.
3. The adapter issues a separate 60-second API credential with that verified identity.
4. `api.ts` checks the required scope and filters database access using the verified company.
5. The structured tool result comes back through MCP to the client.

The user cannot choose another `tenant_id` in tool arguments. The MCP user token is not forwarded to the API.

## Video chapters

| Time | What to follow |
| --- | --- |
| 00:00 | Result and plan |
| 00:51 | Existing API and ticket story |
| 01:29 | Why MCP |
| 02:08 | One request through host, client and server |
| 03:05 | Tools, resources and prompts |
| 03:41 | `npm run demo:local` |
| 04:57 | Our server and project files |
| 05:38 | First tool in `src/mcp.ts` |
| 06:33 | Inspector before an AI application |
| 07:09 | Read T104 |
| 07:48 | Streamable HTTP |
| 08:28 | OAuth sign-in |
| 09:28 | Scopes and company permissions |
| 10:06 | Separate API credential |
| 10:26 | Prepare and confirm |
| 11:11 | Retry one draft without duplicates |
| 11:54 | Bounded failures |
| 12:35 | Treat customer text as data |
| 13:15 | Operating the service |
| 13:54 | Hosted ChatGPT read |
| 14:38 | Another client and isolation check |
| 15:02 | Alternatives |
| 16:23 | Private connections and distribution |
| 17:31 | What still needs launch evidence |

## Check your understanding

- What remains the source of truth? The API and its database.
- Who authenticates Maya? The identity provider. The server verifies the resulting token.
- Can a tool annotation grant access? No. Server/API authorization enforces access.
- Is a successful Inspector call enough to release? No. Also test the real host, approval behavior, operations and failure cases.
