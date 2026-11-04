import { Pool } from "pg";
import { z } from "zod";
import { createApi } from "./api.js";

const config = z.object({
  DATABASE_URL: z.url(),
  DELEGATION_SECRET: z.string().min(32),
}).parse(process.env);
const database = new URL(config.DATABASE_URL);
if (!["postgres:", "postgresql:"].includes(database.protocol)) {
  throw new Error("A PostgreSQL connection URL is required");
}
database.searchParams.set("sslmode", "verify-full");
const pool = new Pool({
  connectionString: database.href, max: 3,
  connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000,
  statement_timeout: 3000, query_timeout: 4000,
  allowExitOnIdle: true,
});
pool.on("error", () => console.error(JSON.stringify({ event: "database_connection_error" })));

export default createApi({ pool, delegationSecret: new TextEncoder().encode(config.DELEGATION_SECRET) });
