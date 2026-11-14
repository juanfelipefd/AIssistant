import assert from "node:assert/strict";
import { test } from "node:test";

import { sql } from "drizzle-orm";

import { withDb, type Tx } from "@/db";
import { trackRelevance, tracks } from "@/db/schema";
import { getTrack, listTracks } from "@/lib/tracks";

// These run against the real database, each inside a transaction that is
// always rolled back — nothing persists, and the append-only trigger on
// track_relevance is never involved.

class Rollback extends Error {}

async function inRolledBackTransaction(fn: (tx: Tx) => Promise<void>) {
  await withDb(async (db) => {
    try {
      await db.transaction(async (tx) => {
        await fn(tx);
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
  });
}

async function insertTrack(tx: Tx, name: string, status: "active" | "archived") {
  const [track] = await tx
    .insert(tracks)
    .values({ name, kind: "study", charter: "", weeklyMinutesTarget: 60, status })
    .returning();
  return track;
}

test("same effective_from twice in one day: the later created_at is current", async () => {
  await inRolledBackTransaction(async (tx) => {
    const track = await insertTrack(tx, "__test__ tie-break", "active");
    // Inserted latest-first, so the result can't come from insertion order.
    await tx.insert(trackRelevance).values([
      {
        trackId: track.id,
        weight: 5,
        rationale: "second thoughts, evening",
        effectiveFrom: sql`current_date`,
        createdAt: sql`now() - interval '1 hour'`,
      },
      {
        trackId: track.id,
        weight: 2,
        rationale: "first thoughts, morning",
        effectiveFrom: sql`current_date`,
        createdAt: sql`now() - interval '10 hours'`,
      },
      {
        trackId: track.id,
        weight: 1,
        rationale: "yesterday",
        effectiveFrom: sql`current_date - 1`,
        createdAt: sql`now() - interval '30 hours'`,
      },
      {
        trackId: track.id,
        weight: 3,
        rationale: "after the exam (future-dated)",
        effectiveFrom: sql`current_date + 7`,
        createdAt: sql`now()`,
      },
    ]);

    const detail = await getTrack(tx, track.id);
    assert.equal(detail?.current_relevance?.rationale, "second thoughts, evening");
    assert.equal(detail?.relevance_history.length, 4);

    const listed = (await listTracks(tx)).find((t) => t.id === track.id);
    assert.equal(listed?.current_relevance?.rationale, "second thoughts, evening");
  });
});

test("list excludes archived tracks unless explicitly included", async () => {
  await inRolledBackTransaction(async (tx) => {
    const active = await insertTrack(tx, "__test__ active", "active");
    const archived = await insertTrack(tx, "__test__ archived", "archived");

    const defaultIds = (await listTracks(tx)).map((t) => t.id);
    assert.ok(defaultIds.includes(active.id));
    assert.ok(!defaultIds.includes(archived.id), "archived track listed by default");

    const allIds = (await listTracks(tx, { includeArchived: true })).map((t) => t.id);
    assert.ok(allIds.includes(active.id));
    assert.ok(allIds.includes(archived.id));
  });
});
