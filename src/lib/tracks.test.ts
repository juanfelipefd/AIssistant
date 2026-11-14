import assert from "node:assert/strict";
import { test } from "node:test";

import { sql } from "drizzle-orm";

import { trackRelevance } from "@/db/schema";
import { inRolledBackTransaction, insertTestTrack } from "@/lib/test-db";
import { getTrack, listTracks } from "@/lib/tracks";

test("same effective_from twice in one day: the later created_at is current", async () => {
  await inRolledBackTransaction(async (tx) => {
    const track = await insertTestTrack(tx, "__test__ tie-break");
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

test("tied on effective_from AND created_at: id breaks the tie, stable across queries", async () => {
  await inRolledBackTransaction(async (tx) => {
    const track = await insertTestTrack(tx, "__test__ relevance id tie");
    const low = "00000000-0000-4000-8000-000000000001";
    const high = "ffffffff-ffff-4fff-bfff-ffffffffffff";
    // One statement, one now(): identical effective_from and created_at.
    // Low id inserted first, so physical order disagrees with the expected
    // (id DESC) order.
    await tx.insert(trackRelevance).values([
      { id: low, trackId: track.id, weight: 2, rationale: "low id", effectiveFrom: sql`current_date` },
      { id: high, trackId: track.id, weight: 4, rationale: "high id", effectiveFrom: sql`current_date` },
    ]);

    for (let i = 0; i < 3; i++) {
      const detail = await getTrack(tx, track.id);
      assert.equal(detail?.current_relevance?.id, high);
      assert.deepEqual(detail?.relevance_history.map((r) => r.id), [high, low]);
      const listed = (await listTracks(tx)).find((t) => t.id === track.id);
      assert.equal(listed?.current_relevance?.id, high);
    }
  });
});

test("list excludes archived tracks unless explicitly included", async () => {
  await inRolledBackTransaction(async (tx) => {
    const active = await insertTestTrack(tx, "__test__ active");
    const archived = await insertTestTrack(tx, "__test__ archived", "archived");

    const defaultIds = (await listTracks(tx)).map((t) => t.id);
    assert.ok(defaultIds.includes(active.id));
    assert.ok(!defaultIds.includes(archived.id), "archived track listed by default");

    const allIds = (await listTracks(tx, { includeArchived: true })).map((t) => t.id);
    assert.ok(allIds.includes(active.id));
    assert.ok(allIds.includes(archived.id));
  });
});
