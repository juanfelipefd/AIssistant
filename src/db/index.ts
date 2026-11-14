import "server-only";

import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle, type NeonDatabase } from "drizzle-orm/neon-serverless";
import ws from "ws";

import * as schema from "./schema";

// WebSocket Pool driver (not neon-http) so the app gets real multi-statement
// transactions. Explicit ws constructor: Node versions before 22 have no
// global WebSocket.
neonConfig.webSocketConstructor = ws;

export type Db = NeonDatabase<typeof schema>;
/** A transaction handle; accepted anywhere a Db is, for composing queries. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Runs `fn` with a database handle scoped to this call.
 *
 * On serverless, a WebSocket connection cannot outlive the request that
 * opened it, so the Pool is created, used and closed inside one handler —
 * never held at module level. Call once per request handler and do all of
 * that request's queries (and transactions) inside `fn`.
 */
export async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    return await fn(drizzle(pool, { schema }));
  } finally {
    await pool.end();
  }
}
