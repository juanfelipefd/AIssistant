# Bitácora / AIssistant — Build Log

Running record of what's built, what's next, and conventions decided *during* the
build that aren't in `SPEC.md`. Keep this next to the spec; update it each session.

**Repo:** `juanfelipefd/AIssistant` · **Live:** https://aissistant-gamma.vercel.app/

---

## Status

**Phase 0 — Scaffold: ~75% complete.**
Deployed and installable as a PWA. Database pipeline wired and verified.
Full schema (12 tables) migrated and verified against the live Neon database.
Remaining: auth, token accounting.

---

## Done

### Environment setup
Gentle-AI 2.7.0 with Claude Code + Pi. Engram, CodeGraph, context7, Playwright
all connected. SDD initialized; Engram is the persistence backend.

Three problems solved along the way, recorded so they don't recur:

- **Duplicate engram binaries** in PATH (`AppData\Local\engram\bin` and
  `go\bin`). Removed the Go one. Two copies can drift to different versions and
  silently use different databases.
- **Engram MCP missing from Claude Code.** Gentle-AI's installer runs
  `engram setup claude-code --mcp-only`, but the engram CLI doesn't recognise
  `--mcp-only` — it falls back to an interactive menu, finds no TTY in a hook
  context, and fails silently. You get the CLAUDE.md protocol and none of the
  tools. Fix: run `engram setup claude-code` manually. Known open bug,
  [gentle-ai#4681](https://github.com/Gentleman-Programming/gentle-ai/issues/4681).
  **If memory tools ever go quiet, check `claude mcp list` first.**
- **jq required** by the Claude Code engram plugin on Windows. Installed via
  `winget install jqlang.jq`; the editor needed a full restart to see it on PATH.

### Session 1 — Deployable skeleton
`9182b7b` · Next.js App Router, TypeScript, Tailwind, `src/`. Placeholder page,
PWA manifest via `app/manifest.ts`, `.env.example`. Deployed to Vercel.
Confirmed installable — opens standalone, no address bar.

`3c91d12`, `024d888` · Project rules relocated. See conventions below.

### Session 2 — Database pipeline
`50b77ae` · Drizzle + `@neondatabase/serverless` (`neon-http` driver).
`drizzle.config.ts`, `src/db/schema.ts`, `src/db/index.ts`, first migration.
Scripts: `db:generate`, `db:migrate`, `db:studio`.

One table only — `activity_types` — deliberately. Proving the pipeline before
putting the real schema through it means any later failure is definitely the
schema, not the plumbing.

Verified against the live Neon database via `information_schema.columns`, not
assumed. **Keep requiring this: "tell me how you verified it."**

### Session 3 — The full schema
`src/db/schema.ts`, `drizzle/0001_chemical_king_bedlam.sql` · All remaining
tables from SPEC §5 (11 new tables + the `activity_types.status` column), plus
new enums, composite FKs, CHECK constraints, a partial unique index, an
append-only trigger, and a generated tsvector column. Verified against the
live Neon database via `information_schema`/`pg_catalog` queries — see the
schema-pass Engram memory for the full query/result detail.

**`where_` → `location`.** The `memories` table's SPEC-§5 `where_` field is
the DB column `location` (self-describing, no quoting needed in Drizzle
Studio). The future `lib/memory.ts` TS interface (SPEC §7) deliberately keeps
the parameter name `where` — Drizzle maps `where` (JS-side) to `location`
(DB-side) in one line when that code gets written. This is a deliberate
TS-param-to-DB-column mapping, not an inconsistency.

**`day_of_week` is ISO 8601, not JS.** `week_template_blocks.day_of_week` is
`1 = Monday ... 7 = Sunday`, deliberately overriding JavaScript's native
`Date.getDay()` (`0 = Sunday`). `week_plans.week_start` is Monday-anchored,
and two disagreeing week conventions in one schema is exactly what produces
an off-by-one bug. Any future JS code touching `day_of_week` must convert at
exactly one boundary helper function — not built yet.

**Relevance-is-mandatory is an app-layer rule, not a DB one.** SPEC §2 says
"relevance is mandatory, no track exists without one," but a database FK
can't enforce that: a `tracks` row must exist before its first
`track_relevance` row can reference it. Known limitation of the schema
alone — the track-creation flow (not built yet) needs to insert both the
track and its opening relevance row together, e.g. in one transaction.

**Forward note for `lib/memory.ts` (SPEC Phase 2, not built yet):**
`roadmap_items.topic_key` (nullable) and `memories.topic_key` (NOT NULL) are
now composite FKs to `topic_keys(track_id, key)`, not free text. Once
`save_memory()` exists it must upsert the `topic_keys` registry row *before*
inserting into `memories` or `roadmap_items` — an insert referencing a
topic_key that isn't in the registry yet will fail the FK, by design.

**Two raw-SQL hand-writes, one gotcha found live:**
- `track_relevance`'s append-only rule is a `BEFORE UPDATE OR DELETE` trigger
  that `RAISE EXCEPTION`s — Drizzle can't express triggers, so it's raw SQL
  in the migration file. `REVOKE UPDATE/DELETE` was rejected: the Neon
  connection role owns the table, and owners bypass privilege revokes.
- `memories.search_vector` (generated tsvector over `what`/`why`/`learned`,
  GIN indexed) is also hand-written raw SQL — Drizzle's generated-column
  support is awkward for this case.
- The `sessions` partial unique index (at most one `status = 'active'` row)
  **did not** need raw SQL — `uniqueIndex(...).on(...).where(sql\`...\`)` is
  fully supported by the installed drizzle-orm 0.45.3 / drizzle-kit 0.31.11.
- Gotcha: a composite FK (`memories`/`roadmap_items` → `topic_keys`) requires
  the referenced columns to carry a real `UNIQUE` **constraint** — a
  `uniqueIndex()` alone fails with Postgres error 42830 ("no unique
  constraint matching given keys"), even though a unique index and a unique
  constraint look interchangeable everywhere else. `topic_keys` uses
  `unique(...).on(track_id, key)`, not `uniqueIndex(...)`. This was caught
  live: the first migration attempt partially applied against the real
  database before failing on this FK, and had to be cleaned up (drop the
  partially-created tables/enums/column) and re-applied inside one explicit
  transaction — the `neon-http` driver doesn't wrap multi-statement
  migrations in a transaction on its own, so a mid-migration failure leaves
  partial state instead of rolling back.
- `drizzle-kit migrate` (the CLI) failed silently under Git Bash on Windows —
  its spinner/TTY handling seems to swallow the real error. Worked around by
  driving `drizzle-orm/neon-http/migrator`'s `migrate()` function
  programmatically instead of the CLI wrapper.

---

## Conventions decided during the build

Not in `SPEC.md`; discovered while building. Follow them.

| Decision | Detail | Why |
|---|---|---|
| **Primary keys** | `uuid` + `defaultRandom()` everywhere | Consistent across the FK web; no cross-environment collisions. Consequence: random UUIDs make `ORDER BY id` meaningless — order by `created_at`. |
| **Driver (app runtime)** | `drizzle-orm/neon-http` | HTTP-based, no connection-pool problems on serverless. No multi-statement transactions — fine for runtime queries, which are single-statement. |
| **Driver (migrations only)** | `drizzle-orm/neon-serverless` (`Pool` + `ws`), via `scripts/migrate.ts` | `neon-http` can't run migrations inside a real transaction, so a mid-migration failure used to leave partial schema state. The WebSocket `Pool` supports real `BEGIN`/`COMMIT`/`ROLLBACK`; Drizzle's migrator already wraps the batch in one transaction once the driver supports it. `npm run db:migrate` now runs this script, not the `drizzle-kit migrate` CLI (which failed silently under Git Bash on Windows). App runtime is untouched — still `neon-http`. |
| **`dotenv`** | Required as a dev dependency | drizzle-kit runs outside Next.js, so it doesn't get automatic `.env.local` loading. |
| **Project rules** | Live in `docs/WORKING-RULES.md`; `CLAUDE.md` is just `@docs/WORKING-RULES.md` | `AGENTS.md` is **regenerated by `next dev`/`next build`** — anything written there is lost. Let it revert freely; ignore its diffs. |
| **Neon** | Connection string only. No Neon CLI, MCP, skills or `neon.ts` | Drizzle already owns the database layer; a second config system is a future collision. Revisit only if schema debugging gets painful. |
| **Neon region** | `us-east-1`, to match Vercel's default function region (`iad1`) | Cross-region queries add latency on every call, and context assembly makes several per session open. |
| **`memories` full-text search on a small table** | `EXPLAIN` on the search-vector query shows a sequential scan, not an index scan, until the table has enough rows for the planner's cost math to favor `memories_search_vector_idx` | Correct planner behavior, not a broken index — a 3-row table will never justify a GIN index. Verified the index is real and gets picked by forcing it with `enable_seqscan = off`. |
| **`track_relevance` append-only escape hatch** | `ALTER TABLE track_relevance DISABLE TRIGGER track_relevance_append_only` → delete → `ENABLE TRIGGER` | The documented repair path for the append-only trigger. Exercised end-to-end during functional testing (to clean up a test row) and confirmed working. |

---

## Next up

**Session 4 — Auth.** Password from env → signed cookie, middleware-protected
routes. About an hour.

**Session 5 — Token accounting + Phase 0 close.** Per-session token logging,
running monthly total, hard cap. Plus the two-minute fix still outstanding: the
page title is still "Create Next App".

**Then Phase 1** — tracks, charters, relevance. Creating a track is a
*conversation*, not a form.

---

## How the sessions run

Slices sized to finish inside 1–2 hours, so nothing is left half-done overnight.
Every session ends with a verified, committed state. Verification means checking
reality — query the database, run the build — never asserting success. Claude Code
builds; review happens before each commit, and before anything structural.

Scope discipline is the main defence: implement only the current slice. If
something looks missing, ask before adding it.