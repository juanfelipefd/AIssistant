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
