# Bitácora / AIssistant — Build Log

Running record of what's built, what's next, and conventions decided *during* the
build that aren't in `SPEC.md`. Keep this next to the spec; update it each session.

**Repo:** `juanfelipefd/AIssistant` · **Live:** https://aissistant-gamma.vercel.app/

---

## Status

**Phase 0 — Scaffold: complete.**
Deployed and installable as a PWA (manifest; opens standalone). Database
pipeline wired and verified. Full schema (13 tables) migrated and verified
against the live Neon database. Single-user auth in place. Token accounting
with a hard cap, verified with a real call and a real refusal.

Before the first model call on the deployed app, Vercel needs
`ANTHROPIC_API_KEY` and `MONTHLY_BUDGET_USD` — without the budget,
`callModel()` refuses every call, by design.

**Next: Phase 1.**

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
- **"multiple active runtime sessions" on save.** Running more than one Claude
  Code instance against this project (e.g. the desktop app and the VS Code
  extension) opens one Engram session each. A save without an explicit session
  ID then matches several open sessions for the same directory and fails closed
  instead of guessing. `engram doctor --project aissistant` reports it as
  `ambiguous_active_runtime_sessions`. Workaround: pass the session ID
  explicitly — the Claude Code session ID, i.e. the transcript filename under
  `~/.claude/projects/<project>/`. **Rule: ONE Claude Code instance per project
  at a time.**
- **Leftover sessions from 2026-11-13.** `3d47b2f1`, `93919c55` and `0ff7c13b`
  have zero observations and can be deleted later with
  `engram delete session <id>` — but only when no Claude Code or Pi process is
  running, since an open instance may still be bound to one of them. Leave the
  September session `4b1e4cf8` alone: it holds 7 observations and is merely
  unclosed.

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

### Session 4 — Auth
Single-user password auth: `POST /api/auth/login` checks `APP_PASSWORD`
(timing-safe), sets an HS256 `jose` JWT in an httpOnly `session` cookie
(90 days); `POST /api/auth/logout` clears it. `src/middleware.ts` redirects
unauthenticated requests to `/login`. API routes also guard themselves with
`requireSession()` from `src/lib/auth.ts` — see `WORKING-RULES.md`.

**Matcher exclusions are segment-anchored.** The first matcher excluded public
paths by prefix (`(?!login|api/auth|...)`), so a future `/api/authorize` would
have bypassed auth entirely. Each exclusion now ends in `(?:/|$)` or `$`, and
dots are escaped. The manifest declares no `icons`; the only icon is
`favicon.ico`, already excluded. If icons are added to `manifest.ts` later,
their paths must be added to the matcher exclusions too.

**Accepted and deferred decisions:**

- **No rate limiting on `/api/auth/login` — accepted risk, not an oversight.**
  Mitigation is password length: `APP_PASSWORD` is 32 random characters, which
  puts online brute force out of reach.
- **`middleware` → `proxy` migration deferred.** Both filenames are recognised
  in Next 16.3.6 (`MIDDLEWARE_FILENAME` and `PROXY_FILENAME` in
  `next/dist/build/utils.js`). Open question: `proxy` may run on the Node.js
  runtime only, which would make the Edge-runtime reasoning behind choosing
  `jose` obsolete. Verify against the actual docs before migrating.
- **A missing `AUTH_SECRET` fails closed.** `getSecretKey()` throws, and
  `verifySessionToken` catches it and returns false, so middleware redirects to
  `/login`. **Diagnostic: an endless redirect to `/login` AND login itself
  failing means check that `AUTH_SECRET` is set.**

### Session 5 — Token accounting
`drizzle/0002_chunky_songbird.sql`, `drizzle/0003_cache_columns_drop_tokens_used.sql`
· The meter goes in before the thing it meters: there are no model calls yet,
so every call from the first one is counted.

- **`token_usage`** — one row per model call: model, input/output tokens,
  nullable `cache_creation_input_tokens`/`cache_read_input_tokens`, purpose,
  nullable `session_id`. Stores token **counts** (facts); cost is derived at
  read time, so a pricing change never corrupts history.
- **`src/lib/ai.ts`** is the single gateway and the only importer of
  `@anthropic-ai/sdk`. `callModel()` checks month-to-date spend against
  `MONTHLY_BUDGET_USD` *before* calling, then logs the call's tokens. Cost
  comes from the `RATES` constant at the top of the file — **updated by hand
  when Anthropic changes pricing.**
- **`/usage`** — server component, one number: month-to-date (UTC) spend.

**Verified with real calls, not assumed.** One `claude-opus-5-5` call through
`callModel()` wrote a `token_usage` row matching the API's reported usage
(18 input / 4 output → $0.000152); `/usage` showed it. With
`MONTHLY_BUDGET_USD=0.0001` (below that spend) the next call threw
`BudgetExceededError` and the row count stayed at 1 — no API request made.

**Spec fix:** SPEC §9 listed the service worker in both Phase 0 and Phase 6
("offline shell") — a September drafting error. Removed from Phase 0: the
manifest alone gives installed + standalone; offline belongs to Phase 6.

**Accepted and deferred decisions:**

- **Cap is `spent >= budget` — fails closed, by design.** A budget of `0` is
  a kill switch: no model call runs. An unset or invalid `MONTHLY_BUDGET_USD`
  also refuses every call. The budget is simply what Juan is willing to spend
  per month.
- **"Month" is the UTC calendar month** (`date_trunc('month', now())` in
  Postgres). The budget is a safety net, not an accounting ledger; resetting
  five hours early on the last day of the month doesn't matter. `/usage` says
  "(UTC)" so it isn't confusing.
- **Refusal fallbacks deferred — their own slice.** With server-side
  fallbacks, a declined request is re-run on another model *inside the same
  response*, and each model's part is billed at its own rates. One
  `token_usage` row per call can't represent that; the meter needs per-model
  logging (one row per model that ran) before fallbacks are enabled.
- **Cache columns added before caching exists.** Context assembly will inject
  the same charter, handoff and memories every turn — exactly the
  repeated-prefix pattern prompt caching is for. Cache tokens are reported
  outside `input_tokens`, so without the columns the meter would silently
  undercount once caching is on. `RATES` has no cache prices yet, so
  `getMonthToDateUsage()` throws if any cache tokens appear — add cache rates
  in the same change that enables caching.
- **`sessions.tokens_used` dropped.** It predated `token_usage` and duplicated
  it. Per-session tokens are `SUM(token_usage)` for that `session_id` — one
  source of truth. SPEC §5 updated.

### Phase 1 · Session 1 — Track API
`src/lib/tracks.ts`, `src/app/api/tracks/**` · No UI. `POST/GET /api/tracks`,
`GET/PATCH /api/tracks/[id]`, `POST /api/tracks/[id]/relevance`, all behind
`requireSession()`.

- Create writes the track and its first relevance row in **one
  transaction**. Verified by forcing the second insert to fail at the database
  (weight 9, bypassing zod → `CHECK` violation `23514`): the track insert
  rolled back with it.
- No delete endpoint (`DELETE` → 405). Archiving is `PATCH {"status":"archived"}`.
- PATCH writes only `tracks`; relevance keys in its body are rejected (400).
  Relevance changes only by appending a row.
- "Current relevance" = latest `effective_from <= current_date` (database
  date, i.e. UTC), newest `created_at` breaking ties — so changing your mind
  twice in one day resolves to the later judgement. Future-dated rows work
  as scheduled changes ("after the exam, calculus drops to 2"). Both
  covered by `src/lib/tracks.test.ts`.
- `GET /api/tracks` excludes archived tracks unless `?include_archived=true`.
- Verification rows (`__verify__*`) were removed afterwards with the
  append-only escape hatch, in one transaction; trigger confirmed re-enabled.

### Phase 1 · Session 2 — Deadlines and roadmap items
`src/lib/deadlines.ts`, `src/lib/roadmap.ts`, `src/app/api/{tracks/[id]/deadlines,deadlines/[id],tracks/[id]/roadmap,roadmap/[id]}` · API only.
Same conventions as session 1 (`requireSession()`, zod, snake_case, thin
routes).

- **Deadlines:** create, list (by `due_date`), PATCH, and **DELETE** (204).
- **Roadmap items:** create (appended at `max + 100`), list (by position,
  skipped excluded by default), PATCH. No DELETE (405) — `skipped` is the
  soft-delete.
- **`completed_at`** is set when an item moves *into* `done` and cleared when
  it moves out. A redundant `done` keeps the original completion time
  (done as one SQL `CASE` against the pre-update status).
- **`topic_key`** must already be registered for the track — rejected
  otherwise (see conventions).
- `estimated_minutes > 0` enforced by zod and by the existing `CHECK` (both
  tested).
- SPEC §9: conversational track creation moved from Phase 1 to Phase 3 — it
  shares the chat component with session chat and the Desk.
- Verified with 10 tests plus real HTTP requests; verification rows removed
  afterwards in one transaction (escape hatch for `track_relevance`).

---

## Pending schema changes

Decided, not yet migrated. Migrate when the slice that needs it is built.

- **The Desk — open, track-less conversations** (SPEC §6, build in Phase 3
  with session chat):
  - `sessions.track_id` → nullable
  - new `sessions.kind` enum: `'track' | 'open'`
  - `memories.track_id` → nullable
  - `sessions_one_active_idx` (one active session) scoped to
    `kind = 'track'` only, so an open chat never blocks real work
  - Migration pending.

---

## Conventions decided during the build

Not in `SPEC.md`; discovered while building. Follow them.

| Decision | Detail | Why |
|---|---|---|
| **Primary keys** | `uuid` + `defaultRandom()` everywhere | Consistent across the FK web; no cross-environment collisions. Consequence: random UUIDs make `ORDER BY id` meaningless — order by `created_at`. |
| **Driver (app runtime)** | `drizzle-orm/neon-serverless` (WebSocket `Pool` + `ws`), via `withDb()` in `src/db/index.ts` — **reversed** from `neon-http` in Phase 1 | The app now needs real multi-statement transactions (a track and its first relevance row are written atomically), which `neon-http` can't do. Its latency advantage is irrelevant at single-user request volume. **Per-request pool:** on serverless a WebSocket can't outlive the request that opened it (Neon driver README), so `withDb(fn)` creates the `Pool`, runs `fn`, and closes it — never a module-level client. One `withDb` per request handler; long waits (a model call) happen outside it. `ws` is a runtime dependency because Node before 22 has no global `WebSocket`. |
| **Driver (migrations)** | `drizzle-orm/neon-serverless` (`Pool` + `ws`), via `scripts/migrate.ts` | Same driver as the app. `neon-http` can't run migrations inside a real transaction, so a mid-migration failure used to leave partial schema state. Drizzle's migrator wraps the batch in one transaction once the driver supports it. `npm run db:migrate` runs this script, not the `drizzle-kit migrate` CLI (which failed silently under Git Bash on Windows). |
| **snake_case everywhere on the wire** | Every API request and response body, query param, and (from Phase 3) every model tool-call schema uses snake_case. camelCase exists only inside TypeScript (Drizzle row objects), translated at one serializer per resource. | One convention across the whole system means less translation: it matches SPEC §5 and the database, **and** the Anthropic API's own fields (`max_tokens`, `stop_reason`, `input_tokens`, `tool_use`) — tool schemas the model reads and fills will be snake_case too. Don't let Phase 3 drift into camelCase. |
| **API shape** | Input validated with zod (`strictObject` — unknown keys are a 400); errors are `{ error, issues: [{ path, message }] }` | Strict schemas are what make "PATCH cannot touch relevance" enforceable, not just a convention. Helpers: `readJson()` / `validate()` in `src/lib/http.ts`. |
| **Lists exclude soft-deleted rows by default** | `GET /api/tracks` omits archived tracks (`?include_archived=true` opts in); `GET /api/tracks/[id]/roadmap` omits skipped items (`?include_skipped=true`). Same defaults in `listTracks()` / `listRoadmapItems()`. | Choose the failure mode you'd notice. If the default included them, a consumer that forgets to filter (the Phase 5 ranking above all) would let archived tracks or skipped items silently compete for time. Excluding by default makes forgetting loud: something is visibly missing. |
| **Delete vs soft-delete** | Hard `DELETE` only where nothing references the row and no memory hangs off it — currently **deadlines** only. Tracks archive (`status = 'archived'`); roadmap items skip (`status = 'skipped'`). | FKs are `RESTRICT` and history is data. A mistyped deadline should just go away; a track or roadmap item may be referenced by sessions and memories. |
| **`topic_key` registry is never written by the roadmap API** | A roadmap item's `topic_key` (nullable) must already exist in that track's `topic_keys`; otherwise 400 on `topic_key`. Checked explicitly in `src/lib/roadmap.ts`; the composite FK is the backstop. | The registry exists so keys get reused instead of invented — it should be populated deliberately. Phase 2's `save_memory()` is what upserts it. Revisit if hand-authored roadmaps (or conversational track creation in Phase 3) need to mint keys. |
| **Roadmap positions** | New item: `position = max(position) + 100` for the track (first item 0), computed inside the INSERT over all items including skipped. PATCH may set any integer — positions are **not** unique. List orders by `position, created_at, id`. | Spacing makes inserting between two items a single update. Without a unique constraint, equal positions need a tiebreak or their order is whatever Postgres returns, which can change between queries. `id` is the last key because rows written in one transaction share `now()` and so tie on `created_at` too. Tested. |
| **Tests** | `npm test` — `node:test` via `tsx`, files `src/**/*.test.ts`. DB tests run against the real database inside a transaction that is **always rolled back** (`inRolledBackTransaction` in `src/lib/test-db.ts`, with insert helpers for test fixtures). | No test framework dependency. Rolled-back transactions leave nothing behind and never trip the `track_relevance` append-only trigger. Needs `.env.local` (`DATABASE_URL`). |
| **Unauthenticated `/api/*`** | Middleware returns JSON `401`, not a redirect | An API client should get a status code, not an HTML login page. Pages still redirect to `/login`. Routes also call `requireSession()` themselves (see WORKING-RULES). |
| **`dotenv`** | Required as a dev dependency | drizzle-kit runs outside Next.js, so it doesn't get automatic `.env.local` loading. |
| **Project rules** | Live in `docs/WORKING-RULES.md`; `CLAUDE.md` is just `@docs/WORKING-RULES.md` | `AGENTS.md` is **regenerated by `next dev`/`next build`** — anything written there is lost. Let it revert freely; ignore its diffs. |
| **Neon** | Connection string only. No Neon CLI, MCP, skills or `neon.ts` | Drizzle already owns the database layer; a second config system is a future collision. Revisit only if schema debugging gets painful. |
| **Neon region** | `us-east-1`, to match Vercel's default function region (`iad1`) | Cross-region queries add latency on every call, and context assembly makes several per session open. |
| **`memories` full-text search on a small table** | `EXPLAIN` on the search-vector query shows a sequential scan, not an index scan, until the table has enough rows for the planner's cost math to favor `memories_search_vector_idx` | Correct planner behavior, not a broken index — a 3-row table will never justify a GIN index. Verified the index is real and gets picked by forcing it with `enable_seqscan = off`. |
| **`track_relevance` append-only escape hatch** | `ALTER TABLE track_relevance DISABLE TRIGGER track_relevance_append_only` → delete → `ENABLE TRIGGER` | The documented repair path for the append-only trigger. Exercised end-to-end during functional testing (to clean up a test row) and confirmed working. |

---

## Next up

**Phase 1** — the API is done: tracks, relevance, deadlines, roadmap items.
Remaining: the hand-editing UI on top of it. Conversational track creation
moved to Phase 3 (SPEC §9).

---

## How the sessions run

Slices sized to finish inside 1–2 hours, so nothing is left half-done overnight.
Every session ends with a verified, committed state. Verification means checking
reality — query the database, run the build — never asserting success. Claude Code
builds; review happens before each commit, and before anything structural.

Scope discipline is the main defence: implement only the current slice. If
something looks missing, ask before adding it.