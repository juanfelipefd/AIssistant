import "server-only";

import { and, asc, desc, eq, lte, ne, sql } from "drizzle-orm";
import { z } from "zod";

import type { Db, Tx } from "@/db";
import { trackKind, trackRelevance, trackStatus, tracks } from "@/db/schema";

// Track data access for the /api/tracks routes. The API speaks snake_case
// (matching SPEC §5 and the database), so rows are serialized below.
//
// Invariants enforced here:
// - A track is created together with its first relevance row, in one
//   transaction (SPEC §2: no track exists without relevance).
// - Relevance is append-only: nothing here updates track_relevance (the DB
//   trigger would reject it anyway). New judgements are new rows.
// - There is no delete. Archiving is status = 'archived'.

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

export const trackIdSchema = z.uuid("track id must be a UUID");

const nameSchema = z.string().trim().min(1, "name must not be empty");
const weeklyMinutesTargetSchema = z
  .number()
  .int("weekly_minutes_target must be a whole number of minutes")
  .positive("weekly_minutes_target must be > 0");
const weightSchema = z
  .number()
  .int("weight must be an integer")
  .min(1, "weight must be 1-5")
  .max(5, "weight must be 1-5");
const rationaleSchema = z
  .string()
  .trim()
  .min(1, "rationale must not be empty");

export const createTrackSchema = z.strictObject({
  name: nameSchema,
  kind: z.enum(trackKind.enumValues),
  charter: z.string(),
  weekly_minutes_target: weeklyMinutesTargetSchema,
  // The first relevance judgement, effective today.
  relevance: z.strictObject({
    weight: weightSchema,
    rationale: rationaleSchema,
  }),
});

// Strict: any key not listed here — including weight/rationale/relevance —
// is rejected, so PATCH can never be used to touch relevance.
export const updateTrackSchema = z
  .strictObject({
    name: nameSchema.optional(),
    charter: z.string().optional(),
    weekly_minutes_target: weeklyMinutesTargetSchema.optional(),
    status: z.enum(trackStatus.enumValues).optional(),
  })
  .refine((input) => Object.keys(input).length > 0, {
    message: "provide at least one field to update",
  });

export const appendRelevanceSchema = z.strictObject({
  weight: weightSchema,
  rationale: rationaleSchema,
  // Defaults to today (database date).
  effective_from: z.iso.date().optional(),
});

// GET /api/tracks query: ?include_archived=true opts in to archived tracks.
export const listTracksQuerySchema = z.strictObject({
  include_archived: z.enum(["true", "false"]).optional(),
});

export type CreateTrackInput = z.infer<typeof createTrackSchema>;
export type UpdateTrackInput = z.infer<typeof updateTrackSchema>;
export type AppendRelevanceInput = z.infer<typeof appendRelevanceSchema>;

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

type TrackRow = typeof tracks.$inferSelect;
type RelevanceRow = typeof trackRelevance.$inferSelect;

function trackJson(track: TrackRow) {
  return {
    id: track.id,
    name: track.name,
    kind: track.kind,
    charter: track.charter,
    weekly_minutes_target: track.weeklyMinutesTarget,
    status: track.status,
    created_at: track.createdAt,
  };
}

function relevanceJson(relevance: RelevanceRow) {
  return {
    id: relevance.id,
    weight: relevance.weight,
    rationale: relevance.rationale,
    effective_from: relevance.effectiveFrom,
    created_at: relevance.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Current relevance per track: the row with the latest effective_from on or
 * before today (database date), newest created_at breaking ties, then id —
 * rows written in one transaction share now(), so created_at alone isn't a
 * total order. Same keys as the relevance history in getTrack().
 */
async function currentRelevance(db: Db | Tx, trackId?: string) {
  const rows = await db
    .selectDistinctOn([trackRelevance.trackId])
    .from(trackRelevance)
    .where(
      and(
        lte(trackRelevance.effectiveFrom, sql`current_date`),
        trackId === undefined ? undefined : eq(trackRelevance.trackId, trackId),
      ),
    )
    .orderBy(
      trackRelevance.trackId,
      desc(trackRelevance.effectiveFrom),
      desc(trackRelevance.createdAt),
      desc(trackRelevance.id),
    );
  return new Map(rows.map((row) => [row.trackId, row]));
}

export async function createTrack(db: Db | Tx, input: CreateTrackInput) {
  return db.transaction(async (tx) => {
    const [track] = await tx
      .insert(tracks)
      .values({
        name: input.name,
        kind: input.kind,
        charter: input.charter,
        weeklyMinutesTarget: input.weekly_minutes_target,
      })
      .returning();
    const [relevance] = await tx
      .insert(trackRelevance)
      .values({
        trackId: track.id,
        weight: input.relevance.weight,
        rationale: input.relevance.rationale,
        effectiveFrom: sql`current_date`,
      })
      .returning();
    return { ...trackJson(track), current_relevance: relevanceJson(relevance) };
  });
}

/**
 * Lists tracks with their current relevance. Archived tracks are excluded
 * unless explicitly requested: a consumer that forgets to filter (e.g. the
 * Phase 5 ranking) then fails loudly — a track is missing — instead of
 * silently letting archived tracks compete for time.
 */
export async function listTracks(
  db: Db | Tx,
  { includeArchived = false }: { includeArchived?: boolean } = {},
) {
  const [rows, current] = await Promise.all([
    db
      .select()
      .from(tracks)
      .where(includeArchived ? undefined : ne(tracks.status, "archived"))
      .orderBy(asc(tracks.createdAt)),
    currentRelevance(db),
  ]);
  return rows.map((track) => {
    const relevance = current.get(track.id);
    return {
      ...trackJson(track),
      current_relevance: relevance ? relevanceJson(relevance) : null,
    };
  });
}

export async function getTrack(db: Db | Tx, id: string) {
  const [track] = await db.select().from(tracks).where(eq(tracks.id, id));
  if (!track) {
    return null;
  }
  const [history, current] = await Promise.all([
    db
      .select()
      .from(trackRelevance)
      .where(eq(trackRelevance.trackId, id))
      .orderBy(
        desc(trackRelevance.effectiveFrom),
        desc(trackRelevance.createdAt),
        desc(trackRelevance.id),
      ),
    currentRelevance(db, id),
  ]);
  const relevance = current.get(id);
  return {
    ...trackJson(track),
    current_relevance: relevance ? relevanceJson(relevance) : null,
    relevance_history: history.map(relevanceJson),
  };
}

/** Updates the tracks row only — never track_relevance. */
export async function updateTrack(db: Db | Tx, id: string, input: UpdateTrackInput) {
  const [track] = await db
    .update(tracks)
    .set({
      name: input.name,
      charter: input.charter,
      weeklyMinutesTarget: input.weekly_minutes_target,
      status: input.status,
    })
    .where(eq(tracks.id, id))
    .returning();
  return track ? trackJson(track) : null;
}

export async function trackExists(db: Db | Tx, id: string): Promise<boolean> {
  const [track] = await db
    .select({ id: tracks.id })
    .from(tracks)
    .where(eq(tracks.id, id));
  return track !== undefined;
}

/** Appends a relevance row. Returns null if the track doesn't exist. */
export async function appendRelevance(
  db: Db | Tx,
  trackId: string,
  input: AppendRelevanceInput,
) {
  if (!(await trackExists(db, trackId))) {
    return null;
  }
  const [relevance] = await db
    .insert(trackRelevance)
    .values({
      trackId,
      weight: input.weight,
      rationale: input.rationale,
      effectiveFrom: input.effective_from ?? sql`current_date`,
    })
    .returning();
  return relevanceJson(relevance);
}
