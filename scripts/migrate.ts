/**
 * Dev/build-time migration runner.
 *
 * Runs Drizzle migrations against Neon Postgres using the WebSocket-based
 * `Pool` from @neondatabase/serverless (via drizzle-orm/neon-serverless),
 * instead of the HTTP driver used by the app at runtime (src/db/index.ts).
 *
 * Why: drizzle-orm/neon-http cannot run migrations inside a real transaction,
 * so a mid-migration failure can leave a partially-applied schema. The
 * neon-serverless Pool driver supports real BEGIN/COMMIT/ROLLBACK, and
 * Drizzle's pg-core migrator already wraps the whole migration batch in
 * `session.transaction(...)`, so a failure anywhere in the batch rolls back
 * the entire batch atomically.
 *
 * This script is intentionally NOT under src/ — it is a one-off dev/build
 * tool, not app runtime code, and must never be imported by the app.
 *
 * Usage:
 *   npm run db:migrate
 *   tsx scripts/migrate.ts --folder=./drizzle/some-scratch-folder   (for testing only)
 */
import { config as loadEnv } from "dotenv";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";
import ws from "ws";

loadEnv({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Check .env.local.");
}

neonConfig.webSocketConstructor = ws;

function resolveMigrationsFolder(): string {
  const folderArg = process.argv.find((arg) => arg.startsWith("--folder="));
  if (folderArg) {
    return folderArg.slice("--folder=".length);
  }
  return process.env.MIGRATIONS_FOLDER ?? "./drizzle";
}

async function main() {
  const migrationsFolder = resolveMigrationsFolder();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const db = drizzle(pool);
    console.log(`Running migrations from "${migrationsFolder}" ...`);
    await migrate(db, { migrationsFolder });
    console.log("Migrations applied successfully (or already up to date).");
  } finally {
    await pool.end();
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("Migration failed, transaction rolled back:");
    console.error(err);
    process.exit(1);
  });
