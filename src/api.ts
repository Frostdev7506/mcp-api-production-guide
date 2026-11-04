import express from "express";
import helmet from "helmet";
import { jwtVerify } from "jose";
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { z, ZodError } from "zod";

export const TicketDraftInput = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(4000),
  priority: z.enum(["low", "normal", "high"]).default("normal"),
}).strict();

const TicketId = z.string().regex(/^T\d{3,12}$/);
const ListQuery = z.object({
  status: z.enum(["open", "closed"]).optional(),
  limit: z.coerce.number().int().min(1).max(20).default(10),
  cursor: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
}).strict();

class ApiFailure extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

export interface ApiOptions {
  pool: Pool;
  delegationSecret: Uint8Array;
  rateLimitPerMinute?: number;
}

export function createApi({ pool, delegationSecret, rateLimitPerMinute = 120 }: ApiOptions) {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(express.json({ limit: "16kb" }));
  app.get("/health", (_request, response) => response.json({ status: "ok" }));
  app.get("/ready", async (_request, response) => {
    await pool.query("SELECT 1");
    response.json({ status: "ready" });
  });

  app.use(async (request, response, next) => {
    const match = /^Bearer (\S+)$/.exec(request.headers.authorization ?? "");
    if (!match) {
      response.status(401).json({ error: "authentication_required" });
      return;
    }
    try {
      const { payload } = await jwtVerify(match[1]!, delegationSecret, {
        algorithms: ["HS256"],
        issuer: "urn:mcp-support:adapter",
        audience: "urn:mcp-support:api",
        maxTokenAge: "60s",
      });
      if (!payload.sub || typeof payload.tenant !== "string" || typeof payload.scope !== "string") {
        throw new Error("Missing principal claims");
      }
      response.locals.principal = {
        subject: payload.sub,
        tenant: payload.tenant,
        scopes: payload.scope.split(" "),
      };
      next();
    } catch {
      response.status(401).json({ error: "invalid_token" });
    }
  });

  app.use(async (_request, response, next) => {
    const { tenant, subject } = response.locals.principal;
    const allowed = await pool.query(
      `INSERT INTO rate_limits(principal_key,window_start,used)
       VALUES($1,date_trunc('minute',now()),1)
       ON CONFLICT(principal_key) DO UPDATE SET
        used=CASE WHEN rate_limits.window_start=excluded.window_start THEN rate_limits.used+1 ELSE 1 END,
        window_start=excluded.window_start
       WHERE rate_limits.window_start<excluded.window_start OR rate_limits.used<$2
       RETURNING used`,
      [JSON.stringify([tenant, subject]), rateLimitPerMinute],
    );
    if (!allowed.rowCount) {
      response.setHeader("Retry-After", "60");
      response.status(429).json({ error: "rate_limited" });
      return;
    }
    next();
  });

  app.get("/tickets", async (request, response) => {
    const { tenant, scopes } = response.locals.principal;
    if (!scopes.includes("tickets:read")) {
      response.status(403).json({ error: "insufficient_scope" });
      return;
    }
    const { status, limit, cursor } = ListQuery.parse(request.query);
    const after = cursor ? TicketId.parse(Buffer.from(cursor, "base64url").toString("utf8")) : null;
    const result = await pool.query(
      `SELECT id,title,status,priority FROM tickets WHERE tenant_id=$1
       AND ($2::text IS NULL OR status=$2) AND ($3::text IS NULL OR id>$3)
       ORDER BY id LIMIT $4`,
      [tenant, status ?? null, after, limit + 1],
    );
    const tickets = result.rows.slice(0, limit);
    response.json({
      tickets,
      next_cursor: result.rows.length > limit ? Buffer.from(tickets.at(-1).id).toString("base64url") : null,
    });
  });
  app.get("/tickets/:id", async (request, response) => {
    const { tenant, scopes } = response.locals.principal;
    if (!scopes.includes("tickets:read")) {
      response.status(403).json({ error: "insufficient_scope" });
      return;
    }
    const result = await pool.query(
      "SELECT id, title, description, status, priority FROM tickets WHERE tenant_id = $1 AND id = $2",
      [tenant, TicketId.parse(request.params.id)],
    );
    const ticket = result.rows[0];
    if (!ticket) {
      response.status(404).json({ error: "not_found" });
      return;
    }
    response.json(ticket);
  });
  app.post("/ticket-drafts", async (request, response) => {
    const { subject, tenant, scopes } = response.locals.principal;
    if (!scopes.includes("tickets:write")) {
      response.status(403).json({ error: "insufficient_scope" });
      return;
    }
    const preview = TicketDraftInput.parse(request.body);
    const draftId = randomUUID();
    await pool.query(
      `INSERT INTO ticket_drafts(id,tenant_id,subject_id,title,description,priority,expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,now()+interval '10 minutes')`,
      [draftId, tenant, subject, preview.title, preview.description, preview.priority],
    );
    response.status(201).json({ draft_id: draftId, preview });
  });
  app.post("/tickets", async (request, response) => {
    const { subject, tenant, scopes } = response.locals.principal;
    if (!scopes.includes("tickets:write")) {
      response.status(403).json({ error: "insufficient_scope" });
      return;
    }
    const { draft_id } = z.object({ draft_id: z.uuid() }).strict().parse(request.body);
    const connection = await pool.connect();
    try {
      await connection.query("BEGIN");
      const found = await connection.query(
        `SELECT *, expires_at <= now() AS expired FROM ticket_drafts
         WHERE id=$1 AND tenant_id=$2 AND subject_id=$3 FOR UPDATE`,
        [draft_id, tenant, subject],
      );
      const draft = found.rows[0];
      if (!draft) throw new ApiFailure(404, "not_found");
      const replayed = Boolean(draft.ticket_id);
      if (!replayed && draft.expired) throw new ApiFailure(410, "draft_expired");
      let ticket;
      if (replayed) {
        const existing = await connection.query(
          "SELECT id,title,description,status,priority FROM tickets WHERE tenant_id=$1 AND id=$2",
          [tenant, draft.ticket_id],
        );
        ticket = existing.rows[0];
      } else {
        const inserted = await connection.query(
          `INSERT INTO tickets(tenant_id,title,description,priority) VALUES($1,$2,$3,$4)
           RETURNING id,title,description,status,priority`,
          [tenant, draft.title, draft.description, draft.priority],
        );
        ticket = inserted.rows[0];
        await connection.query("UPDATE ticket_drafts SET ticket_id=$2 WHERE id=$1", [draft_id, ticket.id]);
      }
      await connection.query("COMMIT");
      response.status(replayed ? 200 : 201).json({ ticket, replayed });
    } catch (error) {
      await connection.query("ROLLBACK");
      throw error;
    } finally {
      connection.release();
    }
  });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express requires four parameters for error middleware.
  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    const bodyError = z.object({ type: z.enum(["entity.parse.failed", "entity.too.large"]) }).safeParse(error);
    if (bodyError.success) {
      const oversized = bodyError.data.type === "entity.too.large";
      response.status(oversized ? 413 : 400).json({ error: oversized ? "request_too_large" : "invalid_json" });
    } else if (error instanceof ApiFailure) {
      response.status(error.status).json({ error: error.code });
    } else if (error instanceof ZodError) {
      response.status(400).json({ error: "invalid_input" });
    } else {
      response.status(503).json({ error: "backend_unavailable" });
    }
  });
  return app;
}
