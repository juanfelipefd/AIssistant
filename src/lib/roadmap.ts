import "server-only";

import { and, asc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";

import type { Db, Tx } from "@/db";
import { roadmapItems, roadmapItemStatus, topicKeys } from "@/db/schema";
import { trackExists } from "@/lib/tracks";

// Roadmap item data access for /api/tracks/[id]/roadmap and /api/roadmap/[id].
//
// Invariants enforced here:
// - No delete. status = 'skipped' is the soft-delete (like archiving tracks).
// - New items go last: position = max(position) + 100 for the track, so
//   inserting between two items never requires renumbering.
// - completed_at is set when an item moves INTO 'done' and cleared when it
//   moves out; a redundant 'done' keeps the original completion time.
// - topic_key, when given, must already exist in that track's topic_keys
//   registry. The API never creates registry rows — the registry is
//   populated deliberately, by save_memory() in Phase 2.

export class UnknownTopicKeyError extends Error {
  constructor(readonly topicKey: string) {
    super(
      `topic_key "${topicKey}" is not registered for this track; registry rows are created by saving a memory, not by the roadmap API`,
    );
    this.name = "UnknownTopicKeyError";
  }
}

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

export const roadmapItemIdSchema = z.uuid("roadmap item id must be a UUID");

const titleSchema = z.string().trim().min(1, "title must not be empty");
// Also enforced by the roadmap_items_estimated_minutes_check constraint.
const estimatedMinutesSchema = z
  .number()
  .int("estimated_minutes must be a whole number of minutes")
  .positive("estimated_minutes must be > 0");
const topicKeySchema = z.string().trim().min(1, "topic_key must not be empty");

export const createRoadmapItemSchema = z.strictObject({
  title: titleSchema,
  description: z.string().nullable().optional(),
  estimated_minutes: estimatedMinutesSchema,
  topic_key: topicKeySchema.nullable().optional(),
});

export const updateRoadmapItemSchema = z
  .strictObject({
    title: titleSchema.optional(),
    description: z.string().nullable().optional(),
    status: z.enum(roadmapItemStatus.enumValues).optional(),
    position: z.number().int("position must be an integer").optional(),
    estimated_minutes: estimatedMinutesSchema.optional(),
    // null detaches the item from its topic.
    topic_key: topicKeySchema.nullable().optional(),
  })
  .refine((input) => Object.keys(input).length > 0, {
    message: "provide at least one field to update",
  });

// GET /api/tracks/[id]/roadmap query: ?include_skipped=true opts in.
export const listRoadmapQuerySchema = z.strictObject({
  include_skipped: z.enum(["true", "false"]).optional(),
});

export type CreateRoadmapItemInput = z.infer<typeof createRoadmapItemSchema>;
export type UpdateRoadmapItemInput = z.infer<typeof updateRoadmapItemSchema>;

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

function roadmapItemJson(item: typeof roadmapItems.$inferSelect) {
  return {
    id: item.id,
    track_id: item.trackId,
    title: item.title,
    description: item.description,
    position: item.position,
    status: item.status,
    estimated_minutes: item.estimatedMinutes,
    topic_key: item.topicKey,
    created_at: item.createdAt,
    completed_at: item.completedAt,
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

async function assertTopicKeyRegistered(
  db: Db | Tx,
  trackId: string,
  topicKey: string | null | undefined,
) {
  if (topicKey === null || topicKey === undefined) {
    return;
  }
  const [row] = await db
    .select({ id: topicKeys.id })
    .from(topicKeys)
    .where(and(eq(topicKeys.trackId, trackId), eq(topicKeys.key, topicKey)));
  if (!row) {
    throw new UnknownTopicKeyError(topicKey);
  }
}

/**
 * Appends an item at the end of the track's roadmap. Returns null if the
 * track doesn't exist; throws UnknownTopicKeyError for an unregistered key.
 */
export async function createRoadmapItem(
  db: Db | Tx,
  trackId: string,
  input: CreateRoadmapItemInput,
) {
  if (!(await trackExists(db, trackId))) {
    return null;
  }
  await assertTopicKeyRegistered(db, trackId, input.topic_key);
  const [item] = await db
    .insert(roadmapItems)
    .values({
      trackId,
      title: input.title,
      description: input.description ?? null,
      estimatedMinutes: input.estimated_minutes,
      topicKey: input.topic_key ?? null,
      // First item gets 0; each later one goes 100 past the current max
      // (computed in the INSERT itself, over every item including skipped).
      position: sql`(select coalesce(max(${roadmapItems.position}) + 100, 0) from ${roadmapItems} where ${roadmapItems.trackId} = ${trackId})`,
    })
    .returning();
  return roadmapItemJson(item);
}

/**
 * A track's roadmap in position order. Skipped items are excluded unless
 * requested. Returns null if the track doesn't exist.
 */
export async function listRoadmapItems(
  db: Db | Tx,
  trackId: string,
  { includeSkipped = false }: { includeSkipped?: boolean } = {},
) {
  if (!(await trackExists(db, trackId))) {
    return null;
  }
  const rows = await db
    .select()
    .from(roadmapItems)
    .where(
      and(
        eq(roadmapItems.trackId, trackId),
        includeSkipped ? undefined : ne(roadmapItems.status, "skipped"),
      ),
    )
    // Total order: equal positions fall back to creation order, and equal
    // created_at (rows written in one transaction share now()) to id — so
    // the same rows always come back in the same order.
    .orderBy(
      asc(roadmapItems.position),
      asc(roadmapItems.createdAt),
      asc(roadmapItems.id),
    );
  return rows.map(roadmapItemJson);
}

/**
 * Updates an item. Returns null if it doesn't exist; throws
 * UnknownTopicKeyError for an unregistered key.
 */
export async function updateRoadmapItem(
  db: Db | Tx,
  id: string,
  input: UpdateRoadmapItemInput,
) {
  const [existing] = await db
    .select({ trackId: roadmapItems.trackId })
    .from(roadmapItems)
    .where(eq(roadmapItems.id, id));
  if (!existing) {
    return null;
  }
  await assertTopicKeyRegistered(db, existing.trackId, input.topic_key);

  // In an UPDATE, column references on the right-hand side read the row's
  // values from BEFORE the update — so "already done" means the old status.
  const completedAt =
    input.status === undefined
      ? undefined
      : input.status === "done"
        ? sql`case when ${roadmapItems.status} = 'done' then ${roadmapItems.completedAt} else now() end`
        : null;

  const [item] = await db
    .update(roadmapItems)
    .set({
      title: input.title,
      description: input.description,
      status: input.status,
      position: input.position,
      estimatedMinutes: input.estimated_minutes,
      topicKey: input.topic_key,
      completedAt,
    })
    .where(eq(roadmapItems.id, id))
    .returning();
  return item ? roadmapItemJson(item) : null;
}
