# Bitácora — MVP Specification

> Working title. The Spanish word for a ship's logbook: the running record of a voyage. Rename freely.

**Status:** Ready to build
**Audience:** Claude Code
**Author:** Juan
**Date:** September 2026

---

## 1. What this is

A personal AI assistant that manages the scarce hours of a working adult who is trying to get very good at several things at once.

It is **not** a to-do app and **not** a calendar. Those already exist and they fail at the thing that matters. The premise here is different: the assistant is **present during the work**. When you sit down to study calculus, it is your tutor for that hour. When you open a code project, it is your pair programmer. When you think through a business question, it is your consultant. Because it was there, it knows what happened — no end-of-day reporting ritual, no logging chore.

Everything it learns accumulates in a durable memory. The value compounds: in week one it is a competent assistant, in month three it knows where you keep getting stuck, what you consistently underestimate, and which foundations are weak.

**The single sentence that defines success:** you have thirty free minutes, you ask what to do, and the answer is *"finish the three improper-integral problems from 7.8 you started Thursday — you got stuck on the second one."* Not "study calculus."

### Design principles

1. **The assistant participates, it does not supervise.** Memory is a byproduct of working together, never a form you fill in.
2. **Propose, then approve.** The assistant suggests schedule changes, roadmap edits and priorities as a concrete diff. You accept or redirect. It never silently rearranges your life.
3. **Search before load.** Never push the archive into context. Query for what is relevant, inject a handful of records, let the assistant pull more as a tool call when the topic shifts.
4. **Tell the truth about capacity.** If the week's intentions exceed the week's available hours, say so and propose what to cut. A tool that lets you over-commit silently is a prettier way to fail.

### What this app is — and what it must never become

**The intelligence is not in this codebase. It is in the model.**

A language model has three structural blindnesses: it has no memory between conversations, no view of your situation, and no way to retrieve just the relevant slice of your history. Every part of this system exists to fix exactly those three. The app is not a wrapper around the model — **it is the model's memory and its eyes.** Its entire job is deciding what the model knows at the moment it thinks.

That framing has a sharp practical consequence, and it is the most important guardrail in this document:

> **Do not write logic the model can perform.**

Concretely, do **not** build: a study-plan generator, a syllabus-decomposition algorithm, a task-ranking formula, heuristics for how hard to push the user on a concept, templates for phrasing suggestions, or a rules engine for when to review something. The model does all of that better than your code will, and every such feature is code you must then maintain and fight. When you catch yourself reaching for clever logic, ask instead: *could the model do this if I gave it the right context?* Usually yes — and then the job shrinks to supplying that context.

**The one line that must not be crossed: the app does the arithmetic.** Hours available, minutes spent, target minus actual, days until a deadline — these are exact numbers and the application computes them from the database. The model is handed the numbers and exercises judgment about what they *mean*. Facts from the system, judgment from the model. **Never ask the model to add up the week.**

A useful side effect of building this way: a thin layer around a model improves every time the model does, at no cost. In a year, with no code changes, this assistant will be a better tutor than on day one. Very little software has that property — do not trade it away by baking intelligence into the codebase.

---

## 2. Vocabulary

| Term | Meaning |
|---|---|
| **Track** | A sustained area of effort. Three kinds: *study* (a college course, a technology, a roadmap), *project* (personal software, business), and *habit* (recurring, e.g. "gym" — no progressive roadmap). Each has a weekly minutes target. A habit track is expected to have no `roadmap_items` at all; that's normal, not a gap. |
| **Charter** | A markdown document per track. Defines purpose, scope, materials, what "done" looks like — **and the role the assistant plays** for that track. Modeled on `AGENTS.md`. |
| **Relevance** | A track's standing importance. Set when the track is created — **mandatory, no track exists without one** — and revised whenever it shifts. Stored with a written rationale and full history, so the assistant knows not just *how* much a track matters but *why*, and can see how your priorities have moved over time. |
| **Session** | One working block on one track. The conversation *is* the session. Opens, you work inside it, closes with a handoff. The unit of record. |
| **Available block** | Calendar time not already committed. The only time the assistant makes decisions about. |
| **Memory** | A structured, searchable record of what was learned, decided or struggled with. Persists across sessions forever. |
| **Roadmap item** | An atomic, resumable unit of work within a track. Small enough to name precisely, sized in minutes. |
| **Handoff** | The structured close of a session: what got done, where you stopped, what's next, what's blocking. Loaded first next time. |

---

## 3. The core loop

**Setting up a track.** You talk to the assistant. It asks what the track is, why you're doing it, what materials exist, what done looks like, how it should behave with you, **how relevant this is against everything else you're carrying and why**, and whether any hard dates exist. It drafts the charter, an opening relevance with its rationale, and an initial roadmap. You correct it. That conversation *is* the onboarding — no forms.

**Planning the week.** You paint your calendar: work, class, commute, and Available. A weekly template holds the usual shape; per-date overrides handle the exceptions. The assistant now knows how many Available hours exist and compares that to the sum of your weekly track targets. If they don't fit, it says so.

**Deciding what to do.** Either you open a track directly, or you ask *"I have 40 minutes, what's there?"* The assistant ranks candidates by what's behind on its weekly target, what's priority this week, and which roadmap items fit the time available. It answers with two or three specific options and a one-line reason for each.

**Working.** A session opens. Context is assembled (see §6) and the assistant takes the role its charter defines. You work. It searches memory when the topic shifts and saves what matters as it goes.

**Closing.** The session ends with a handoff. That handoff is the first thing loaded next time.

---

## 4. Architecture

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js (App Router)** | One codebase for UI and API routes. |
| Hosting | **Vercel** | Free at this scale, deploys in minutes, near-zero ops. |
| Database | **Postgres** (Neon or Supabase free tier) | One datastore for app data *and* memory. Managed backups. Full-text search built in; `pgvector` available later without migration. |
| Client | **PWA** | Installs to the home screen on phone, tablet and laptop from one codebase. No app stores, no second surface. |
| Model | **Claude (Sonnet)** via server-side API route, streaming | |
| Auth | Single-user. Password in an env var → long-lived signed cookie. | One user. An hour of work. Upgrade to Auth.js magic links later if desired. |

### Decisions already made — do not re-litigate

These were each argued out and settled. They are recorded with their reasoning so that a fresh agent — which will have its own opinions — can see *why* rather than re-open them. If you want to change one, change it deliberately, not because it looked odd in passing.

**Postgres, not Engram, for the app's memory.** Engram was the original inspiration for this project and the instinct behind it was correct — but it is local-first (SQLite at `~/.engram/engram.db`) and cannot answer relational questions like "hours spent on calculus this week versus target." This app needs Postgres regardless, for tracks, calendar, sessions and budgets. Engram therefore could never *replace* Postgres, only be *added* to it: a second datastore, a second deploy target, a second backup story, an extra network hop from a serverless function, and a public HTTP surface whose authentication you would have to design yourself — all while holding the one asset the project is meaningless without. Postgres is free on Neon or Supabase, backs itself up, and joins memory to schedule in a single query. **What we take from Engram is its memory contract** (§7) — which is application code, not infrastructure.

**Engram still gets used — during the build, not inside the app.** Installed in the coding agent, it does exactly what it was designed for: remembering architectural decisions across sessions. For a project built in scattered evening blocks over weeks, that is real value.

**Gentle-AI configures the build environment.** It bundles Engram, includes CodeGraph, and runs a spec-driven workflow whose input is this document. Note its own philosophy — deterministic state read from disk rather than a model guessing the next step — mirrors the principle in §1: facts from the system, judgment from the model. Use its full phase flow for structural work; skip it for small changes.

**One code-graph tool, never two.** `codebase-memory-mcp` and `codegraph` are direct competitors solving the same problem. Gentle-AI ships CodeGraph, so that choice is already made.

**Text only in v1.** No voice input, no speech synthesis. This was considered and deferred deliberately.

**Memory sits behind an interface** (§7), so every storage decision above stays reversible for roughly thirty lines of indirection.

**Sessions are built before the calendar** (§9). This is deliberate and counter-intuitive; the reasoning is in that section. Do not reorder it for tidiness.

### Cost

Vercel free, Postgres free, so the only real cost is model tokens.

**A Claude Pro subscription does not include API access.** It covers chat — web, desktop and Claude Code. It pays for *building* this project, not running it.

**The Pro programmatic credit does not apply either.** The $20/month credit that comes with Pro covers the Claude Agent SDK and apps built on it. This app uses `@anthropic-ai/sdk` — the plain Messages API with an API key — which is billed separately, through Console credits.

**`MONTHLY_BUDGET_USD` is a ceiling on that separate spend, not a backup fund.** At one user having a few conversations an evening, real spend is expected to be a few dollars a month. The guard exists so that a bug that loops and re-sends the full memory history can't quietly run up a bill overnight.

So: **log token usage per call in the database, surface a running monthly total, and enforce a hard cap.** Built in Phase 0, before the first model call — see `src/lib/ai.ts`.

---

## 5. Data model

```sql
-- Tracks and their charters
tracks
  id, name
  kind              -- 'study' | 'project' | 'habit'
  charter           -- markdown: purpose, scope, materials, done-criteria, ASSISTANT ROLE
  weekly_minutes_target  -- minutes, not hours: this project standardizes ALL
                          -- duration columns on minutes, to avoid unit-conversion bugs
  status            -- 'active' | 'paused' | 'archived'
  created_at
  -- NOTE: relevance is deliberately NOT a column here. See track_relevance.

-- Relevance: standing importance, versioned rather than overwritten
track_relevance
  id, track_id
  weight            -- 1-5. 5 = drop other things for this.
  rationale         -- WHY, in your own words. The model reads this, not just the number.
  effective_from    -- date
  created_at
  -- Current relevance = the row with the latest effective_from <= today.
  -- Rows are NEVER updated or deleted (DB-enforced via a BEFORE UPDATE OR
  -- DELETE trigger). A new judgement is a new row.
  -- The history of what mattered when is itself data the assistant will use.

-- Hard dates that do not negotiate
deadlines
  id, track_id
  label             -- 'Calculus midterm', 'AWS SAA exam', 'client delivery'
  due_date
  notes

-- Optional: what you decided to push this particular week
week_plans
  id, week_start
  focus             -- nullable free text, e.g. "calculus, midterm on the 14th" —
                        -- the row can exist before the weekly planning conversation fills it in
  created_at, updated_at  -- mutable/revised in place, unlike track_relevance

-- Atomic, resumable units of work
roadmap_items
  id, track_id
  title             -- specific: "Stewart 7.8, problems 12-19"
  description
  position          -- ordering within the track
  status            -- 'todo' | 'in_progress' | 'done' | 'skipped'
  estimated_minutes -- required; this is what makes "I have 30 min" work
  topic_key         -- nullable; links to the memory thread.
                        -- Composite FK: (track_id, topic_key) -> topic_keys(track_id, key)
  created_at, completed_at

-- Calendar: a recurring weekly shape, plus per-date exceptions
activity_types
  id, name          -- 'Work', 'Class', 'Commute', 'Available', 'Gym'
  kind              -- 'committed' | 'available'
  color
  status            -- 'active' | 'archived'

week_template_blocks          -- the usual week
  id, day_of_week, start_time, end_time, activity_type_id
  -- day_of_week is ISO 8601: 1 = Monday ... 7 = Sunday. This does NOT match
  -- JavaScript's Date.getDay() (0 = Sunday) — week_plans.week_start is
  -- Monday-anchored, so JS callers must convert at one boundary helper.

calendar_blocks               -- overrides and additions for a specific date
  id, date, start_time, end_time, activity_type_id, note

-- Sessions: the unit of record
sessions
  id, track_id
  started_at, ended_at
  actual_minutes    -- write-once at session close; NOT derived from
                        -- ended_at - started_at (the honest worked-minutes
                        -- number matters more than wall-clock delta)
  status            -- 'active' | 'closed' | 'abandoned'
  handoff_done      -- what got accomplished
  handoff_stopped   -- exactly where you stopped
  handoff_next      -- the next concrete action
  handoff_blockers  -- what's in the way
  -- Tokens used per session are derived, not stored:
  -- SUM(token_usage.*_tokens) WHERE session_id = sessions.id.

messages
  id, session_id
  role              -- 'user' | 'assistant' ONLY — matches Anthropic's Messages
                        -- API exactly (no 'system', no 'tool' role)
  content           -- jsonb; the Anthropic content-blocks array, verbatim
  created_at

-- Memory: the bitácora
memories
  id, track_id
  topic_key         -- stable, e.g. 'calculus/improper-integrals'. NOT NULL.
                        -- Composite FK: (track_id, topic_key) -> topic_keys(track_id, key)
  what, why, location, learned  -- `location` is the DB column name for what
                                    -- earlier drafts called `where_`
  source_session_id -- nullable: track-creation conversations aren't
                        -- `sessions` rows but can legitimately produce memories
  created_at
  search_vector     -- generated tsvector over what/why/learned ONLY
                        -- (deliberately excluding location), GIN indexed

topic_keys          -- registry, so keys get reused instead of invented
  id, track_id, key, description, last_used_at

-- Token accounting: one row per model call, written only by src/lib/ai.ts
token_usage
  id
  session_id        -- nullable: not every call belongs to a session
  model
  input_tokens, output_tokens
  cache_creation_input_tokens, cache_read_input_tokens  -- nullable
  purpose           -- 'session_chat' | 'track_create' | 'ranking' | ...
  created_at        -- indexed
  -- Stores token COUNTS only — facts. Cost is derived at read time from a
  -- rates table in code, so a pricing change never corrupts history.
```

**Weekly budget is derived, not stored.** Actual minutes = `SUM(sessions.actual_minutes)` for the track within the week. Compare to `tracks.weekly_minutes_target`. No table needed.

**Deferred to v1.1:** a `roadmap_prereqs(item_id, depends_on_id)` join table. That is the concept graph — it lets the assistant say *"you're stuck on convergence because your limits foundation is weak."* Cheap to add later; do not build it now.

---

## 6. The assistant

### Context assembly

When a session opens on a track, the server builds the prompt in this order:

1. **Charter** → the system prompt. This is what makes it a Socratic tutor for calculus and a pair programmer for a code project.
2. **Latest handoff** for this track. Where you are, verbatim.
3. **Roadmap position** — items `in_progress` plus the next few `todo`.
4. **Memory search** — recent memories for this track, plus full-text matches against the current roadmap item's `topic_key`. **Cap at roughly 5–10 records.** Never dump the history.
5. **Budget status** — hours this week versus target, for this track and overall.

### Calendar override semantics (recorded now, built later)

A `calendar_blocks` row **suppresses** any `week_template_blocks` slot it
overlaps on that date — it is **not** a whole-day replacement. Example:
"dinner Tuesday at 20:00" suppresses just the Available block it collides
with, leaving the rest of the day intact. Recorded here now for when the
schedule-reader code gets built later; no schedule-merging logic exists yet.

### The Desk — open conversations (recorded now, built in Phase 3)

Not every thought belongs to a track yet. The **Desk** is an open
conversation surface with no track: it works exactly like a session, but
unscoped. Ideas land there raw, and are later filed into a track or grow
into one.

- **Same machinery as session chat.** A Desk conversation is a `sessions`
  row with `kind = 'open'` and no `track_id`; memories it produces have no
  `track_id` until filed. Built in Phase 3 alongside the session chat.
- **Separate conversations, not one endless thread.** Each Desk chat is its
  own session; recall across them is through memory search.
- **An open chat never blocks real work.** The one-active-session rule
  applies to `kind = 'track'` sessions only.
- **Nothing is filed automatically.** Ideas stay unfiled until explicitly
  filed — no automatic sorting into tracks.

Schema changes (pending migration): `sessions.track_id` nullable,
`sessions.kind` enum `'track' | 'open'`, `memories.track_id` nullable, and
the one-active-session partial index scoped to `kind = 'track'`.

### Tools available during a session

| Tool | Purpose |
|---|---|
| `search_memory(query, track_id?)` | Pull more memory on demand when the topic shifts. This is the mechanism that keeps retrieval relevant without paying context for the archive. |
| `save_memory(topic_key, what, why, where, learned)` | Record something worth keeping. |
| `update_roadmap_item(id, status, note)` | Mark progress as it happens. |
| `get_budget_status()` | Answer "am I behind?" |
| `get_schedule(from, to)` | Read the calendar. |
| `propose_relevance_change(track_id, weight, rationale)` | Suggest a track's standing importance has shifted. Requires your approval; writes a new `track_relevance` row, never an update. |

### Relevance, sequence and priority are three different things

These three words get used interchangeably in ordinary speech. In this system they are distinct concepts with different scopes, different owners and different lifetimes. Conflating them is the most likely conceptual mistake an implementer will make.

| Concept | Scope | Who sets it | How often it changes |
|---|---|---|---|
| **Relevance** | A track | **You declare it** | Occasionally — weeks or months |
| **Sequence** | Items within a track | Prerequisites and structure | Rarely, when the roadmap changes |
| **Priority** | This exact moment | **Nobody — it is concluded** | Every single time you ask |

**Relevance is a property. Priority is an outcome.** You declare relevance; the assistant concludes priority by weighing relevance against debt, urgency, staleness and the minutes actually available right now.

The illustration that makes it concrete — Tuesday, 19:30, ninety minutes free:

> **AWS** is the highest relevance, a 5 with a real reason behind it. But it was worked on yesterday, it is on target for the week, and nothing is due.
> **Calculus** is only a 4 — but is two hours behind target, with a midterm in nine days.
> **Solid state** is a 3, four hours behind, untouched for eleven days.
>
> Tonight's priority is calculus. **The most relevant track is not the highest-priority track**, and that is not a bug — it is the entire reason this system is worth building. If priority simply meant "do the highest-numbered thing," a sorted list would suffice and no assistant would be needed.

**Sequence** is a third thing again: within calculus you do 7.7 before 7.8, not because one matters more but because one depends on the other. That is ordering, and it lives on `roadmap_items.position`.

> ⚠️ **Hard rule: there is no `priority` column anywhere in the database.** The moment priority is stored it is stale, and the system starts fighting its own data. Store the *inputs* — relevance, targets, deadlines, session history. Derive the answer on every request.

The one nuance: **the week's focus** (`week_plans.focus`) is neither relevance nor momentary priority. It is a decision you already made, in advance, for a whole week — "I'm pushing calculus because the midterm is coming." Relevance has not changed; calculus does not suddenly matter more in your life. You simply resolved the tension ahead of time, and the assistant should honour that rather than re-deriving it nightly.

### Relevance and the ranking of tracks

Deciding what deserves your next hour is the second-hardest problem in the app, after retrieval. It is driven by **four distinct forces that must not be collapsed into one number**:

| Signal | Source | Nature |
|---|---|---|
| **Relevance** | `track_relevance` — declared by you | How much this track matters in general, plus the written rationale |
| **Debt** | `weekly_minutes_target` − actual minutes this week | How far behind you are right now |
| **Urgency** | nearest row in `deadlines` | Days remaining until something real happens |
| **Staleness** | days since the last closed session | How long since you touched it at all |

These pull in different directions and that is the point. A track can be highly relevant but ahead of schedule. A low-relevance track can become the only thing that matters because its exam is Thursday. A track you rated 5 and have not opened in three weeks is telling you something.

**The app computes all four as exact numbers. The model does the judging.**

Do **not** write a weighted scoring formula that collapses these into a single rank. That is precisely the kind of clever logic the model is better at than your code, and a formula will produce confidently wrong answers that you then have to fight. The endpoint's job is to assemble the facts — the four signals per active track, this week's `focus` note, and the roadmap items whose `estimated_minutes` fit the window — and hand them over. The model reads the rationales, weighs the tensions, and answers.

### The "what should I do now?" endpoint

Distinct from a session. Input: available minutes, current time. Assembles the signal table above. Output: two or three **specific** suggestions — a named roadmap item, not a track name — each with a one-line reason drawn from the signals. Choosing one opens a session.

> *"Calculus, 7.8 problems 12–19. You're 2h behind target this week and the midterm is in nine days."*
> *"AWS, the IAM module. Relevance 5 and you haven't opened it in eleven days."*

### Relevance drifts, and that is expected

What matters in September is not what matters in December. Relevance is revised, never silently — a new `track_relevance` row with a fresh rationale and effective date.

Two ways it gets revised. **You change it**, during a weekly planning conversation or any time you notice your priorities have moved. Or **the assistant proposes a change**, which is the more interesting path: it has the history, so it can notice that you rated solid state a 4 and have skipped it four weeks running, and ask whether that is still true. Propose, then approve — it never edits relevance on its own.

Because history is preserved rather than overwritten, this becomes one of the richest sources of the pattern insight you eventually want: not just what you said mattered, but what you actually did about it.

### Roles

The assistant's persona comes from a section of each track's charter. This is not decoration — it is the difference between a chatbot and a study partner. Example charter fragment:

```markdown
## Assistant role
You are my calculus tutor. Be Socratic: when I'm stuck, ask the question that
unblocks me rather than giving the answer. Make me derive results rather than
memorize them. If I get something right quickly, push harder. Track which
concepts I repeatedly fumble and bring them up unprompted.
```

---

## 7. The memory contract

All memory access goes through one module — `lib/memory.ts` — exposing exactly these functions. **Nothing else in the app touches the memory tables directly.** This is what keeps the storage decision reversible.

```ts
saveMemory({ trackId, topicKey, what, why, where, learned })
searchMemory({ trackId, query, limit })
getTrackContext({ trackId })        // handoff + roadmap position + recent memory
saveSessionSummary({ sessionId, done, stopped, next, blockers })
```

Four disciplines, adapted from Engram:

**Structured saves.** Every memory has the same four fields, because free-form blobs make search return mush and prevent the model from distinguishing a decision from a fact from a struggle.

> *What:* solved four improper-integral problems from 7.8.
> *Why:* convergence tests are this week's target.
> *Where:* Stewart ch. 7, problems 12, 14, 15, 19.
> *Learned:* I keep forgetting to check the limit at the lower bound when that's the singular one.

`learned` is the field that pays. It is what makes the assistant useful three weeks later instead of merely descriptive.

**Stable topic keys.** Without them you save "improper integrals" today, "convergence of improper integrals" next week, and "ch 7.8 review" after that — three fragments of one thread, and search finds whichever it finds. A stable key (`calculus/improper-integrals`) means every save attaches to the same thread and knowledge *evolves* instead of scattering. The assistant must consult the `topic_keys` registry and reuse an existing key rather than invent a new one.

**Search before load.** Covered in §6. This is the highest-priority requirement in the whole system.

**Session handoff.** Saves answer *"what do I know."* The handoff answers *"where am I."* They are different records with different jobs. The handoff is written at session close and loaded first next time.

---

## 8. Scope

### In v1

Tracks with charters, weekly hour targets and roadmap items. A week calendar with a recurring template plus per-date overrides, marking Available time. Sessions as conversations, with context assembly, in-session tools and handoff on close. The memory layer with the full contract. Budget math — planned versus actual per track per week. The "what should I do now?" endpoint. PWA install and a mobile-first layout. Token accounting with a hard cap.

### Explicitly out of v1, in this order afterward

1. **Natural-language rescheduling** ("I have dinner Tuesday at 20:00, rearrange"). In v1 you edit the calendar by hand. Note that the assistant *asking* you what to move already delivers most of the value and is much simpler.
2. **Concept prerequisite graph** — the `roadmap_prereqs` table and the reasoning on top of it.
3. **Pattern insights** ("you consistently overestimate Monday evenings"). This **cannot** exist at launch — it needs months of history. That is not a compromise, it is arithmetic.
4. **Voice input and output.**
5. **Proactive notifications and nudges.**

### Why v1 looks like this

The most-wanted feature — an assistant that knows your patterns and tells you the truth about your capacity — requires data that does not exist yet. So v1's job is to **start the record**. Every week spent building clever scheduling logic is a week of history not collected. Ship the capture loop, start accumulating, and the intelligence arrives as the data does.

---

## 9. Build order

Each phase should end deployed and usable.

**Phase 0 — Scaffold.** Next.js on Vercel, Postgres connected, full schema migrated, single-user auth, PWA manifest, token accounting with a hard cap. Deploy an empty but working shell.

**Phase 1 — Tracks, charters and relevance.** CRUD for tracks, `track_relevance` and `deadlines`. Creating a track is a *conversation*: the assistant interviews you, drafts the charter, an opening relevance with rationale, and an initial roadmap; you approve or correct. Relevance is mandatory — the create flow cannot complete without one. Revisions append a new row and never overwrite. Roadmap items are editable by hand too.

**Phase 2 — Memory layer.** Implement `lib/memory.ts` and its four functions against Postgres, with full-text search and the topic-key registry. Test in isolation before anything depends on it.

**Phase 3 — Sessions and chat. ← the core.** Open a session on a track, assemble context per §6, stream the conversation, expose the in-session tools, write the handoff on close. **At the end of this phase the app is already genuinely useful and memory starts accumulating.**

**Phase 4 — Calendar.** Activity types, weekly template, per-date overrides, Available blocks, a week view that works on a phone.

**Phase 5 — Budgets, relevance signals and "what now?"** Weekly planned-versus-actual per track. Compute the four ranking signals (relevance, debt, urgency, staleness) and assemble them for the model — no scoring formula. The "what now?" endpoint and its UI. Over-commitment warnings. The weekly planning conversation, including relevance review.

**Phase 6 — Polish.** Mobile layout, install flow, offline shell, a memory browser so you can read your own bitácora.

Sessions come **before** the calendar deliberately. The sessions-plus-memory core is what creates value; the calendar only decides which session to open, and for the first few weeks you can decide that in your head. Building it this way means memory starts accumulating weeks earlier.

---

## 10. Open items

- **Name the project.** "Bitácora" is a placeholder.
- **Initial track set.** Seven tracks were mentioned: solid state, calculus, Next/React, AWS, software-engineering roadmap, gym, personal projects. In roughly 20 weekday Available hours that averages under three hours each, and two of them have external deadlines that will not negotiate. Worth deciding up front which tracks are genuinely active in the first month versus parked — and note that building this app in Next/React on Vercel means the project itself feeds the Next/React track rather than competing with it.