# Bitácora / AIssistant — working rules

`docs/SPEC.md` is the source of truth. Read it before any non-trivial work.

## Scope discipline
Implement only what the current session asks for. This project is built in
1-2 hour evening blocks; scope creep past the requested slice is the main
failure mode. If something looks missing, ask before adding it.

## The central architectural rule
The intelligence belongs to the model, not this codebase. This app supplies
the model with memory, situational awareness and retrieval — nothing more.
Do NOT write: plan generators, task-ranking formulas, syllabus decomposition,
phrasing templates, or rules engines. If the model could do it given the
right context, give it the context instead.

The one exception: the app does all arithmetic. Hours available, minutes
spent, target minus actual, days until a deadline — exact numbers computed
from the database, handed to the model. Never ask the model to add up a week.

## Server/client boundary
Frontend and backend live in the same repo. `src/app/**/page.tsx` is
client-facing; `src/app/api/**/route.ts` and server components are the
backend; `src/db/` is server-only data access.

`src/db/` must NEVER be imported into a client component — `DATABASE_URL`
would end up in the browser bundle. Database access happens in API routes
and server components only. Client code reaches it through `fetch`.

API routes must verify the session themselves, not rely on middleware alone.
Middleware is the first line, not the only one — a matcher mistake or a
future refactor must not silently expose a route. Every route under
`src/app/api/` (except `api/auth/*`) starts with:

```ts
const denied = await requireSession(request);
if (denied) return denied;
```

`requireSession` lives in `src/lib/auth.ts`.

## Settled decisions — do not re-open (see SPEC §4)
- Postgres is the app's memory. Engram is used for THIS BUILD, never inside
  the app.
- Drizzle, not Prisma.
- There is no `priority` column anywhere. Priority is always derived.
  Relevance, debt, urgency and staleness are stored; priority is concluded.
- All memory access goes through lib/memory.ts. Nothing else touches the
  memory tables.
- Sessions are built before the calendar. This is deliberate.
- Text only in v1. No voice.
