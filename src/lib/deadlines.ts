import "server-only";

import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import type { Db, Tx } from "@/db";
import { deadlines } from "@/db/schema";
import { trackExists } from "@/lib/tracks";

// Deadline data access for /api/tracks/[id]/deadlines and /api/deadlines/[id].
//
// Unlike tracks, deadlines can be deleted: nothing references a deadline and
// no memory hangs off it, so a mistyped one should simply go away.

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

export const deadlineIdSchema = z.uuid("deadline id must be a UUID");

const labelSchema = z.string().trim().min(1, "label must not be empty");
const dueDateSchema = z.iso.date("due_date must be a YYYY-MM-DD date");

export const createDeadlineSchema = z.strictObject({
  label: labelSchema,
  due_date: dueDateSchema,
  notes: z.string().nullable().optional(),
});

export const updateDeadlineSchema = z
  .strictObject({
    label: labelSchema.optional(),
    due_date: dueDateSchema.optional(),
    // null clears the notes.
    notes: z.string().nullable().optional(),
  })
  .refine((input) => Object.keys(input).length > 0, {
    message: "provide at least one field to update",
  });

export type CreateDeadlineInput = z.infer<typeof createDeadlineSchema>;
export type UpdateDeadlineInput = z.infer<typeof updateDeadlineSchema>;

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

function deadlineJson(deadline: typeof deadlines.$inferSelect) {
  return {
    id: deadline.id,
    track_id: deadline.trackId,
    label: deadline.label,
    due_date: deadline.dueDate,
    notes: deadline.notes,
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Returns null if the track doesn't exist. */
export async function createDeadline(
  db: Db | Tx,
  trackId: string,
  input: CreateDeadlineInput,
) {
  if (!(await trackExists(db, trackId))) {
    return null;
  }
  const [deadline] = await db
    .insert(deadlines)
    .values({
      trackId,
      label: input.label,
      dueDate: input.due_date,
      notes: input.notes ?? null,
    })
    .returning();
  return deadlineJson(deadline);
}

/** Deadlines for a track, soonest first. Returns null if the track doesn't exist. */
export async function listDeadlines(db: Db | Tx, trackId: string) {
  if (!(await trackExists(db, trackId))) {
    return null;
  }
  const rows = await db
    .select()
    .from(deadlines)
    .where(eq(deadlines.trackId, trackId))
    .orderBy(asc(deadlines.dueDate), asc(deadlines.label));
  return rows.map(deadlineJson);
}

/** Returns null if the deadline doesn't exist. */
export async function updateDeadline(
  db: Db | Tx,
  id: string,
  input: UpdateDeadlineInput,
) {
  const [deadline] = await db
    .update(deadlines)
    .set({ label: input.label, dueDate: input.due_date, notes: input.notes })
    .where(eq(deadlines.id, id))
    .returning();
  return deadline ? deadlineJson(deadline) : null;
}

/** Returns false if the deadline doesn't exist. */
export async function deleteDeadline(db: Db | Tx, id: string): Promise<boolean> {
  const deleted = await db
    .delete(deadlines)
    .where(eq(deadlines.id, id))
    .returning({ id: deadlines.id });
  return deleted.length > 0;
}
