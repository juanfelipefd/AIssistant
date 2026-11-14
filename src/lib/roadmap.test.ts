import assert from "node:assert/strict";
import { test } from "node:test";

import { eq, sql } from "drizzle-orm";

import { roadmapItems } from "@/db/schema";
import {
  createRoadmapItem,
  listRoadmapItems,
  UnknownTopicKeyError,
  updateRoadmapItem,
} from "@/lib/roadmap";
import {
  inRolledBackTransaction,
  insertTestTopicKey,
  insertTestTrack,
} from "@/lib/test-db";

const item = (title: string) => ({ title, estimated_minutes: 30 });

test("successive creates are spaced by 100, per track", async () => {
  await inRolledBackTransaction(async (tx) => {
    const a = await insertTestTrack(tx, "__test__ roadmap A");
    const b = await insertTestTrack(tx, "__test__ roadmap B");

    const a1 = await createRoadmapItem(tx, a.id, item("a1"));
    const a2 = await createRoadmapItem(tx, a.id, item("a2"));
    const b1 = await createRoadmapItem(tx, b.id, item("b1"));
    const a3 = await createRoadmapItem(tx, a.id, item("a3"));
    assert.deepEqual(
      [a1?.position, a2?.position, a3?.position, b1?.position],
      [0, 100, 200, 0],
    );

    // An item moved far down sets the new max; the next create goes after it.
    await updateRoadmapItem(tx, a1!.id, { position: 1000 });
    const a4 = await createRoadmapItem(tx, a.id, item("a4"));
    assert.equal(a4?.position, 1100);

    const titles = (await listRoadmapItems(tx, a.id))?.map((i) => i.title);
    assert.deepEqual(titles, ["a2", "a3", "a1", "a4"]);
  });
});

test("done sets completed_at; leaving done clears it; re-setting done keeps it", async () => {
  await inRolledBackTransaction(async (tx) => {
    const track = await insertTestTrack(tx, "__test__ completed_at");
    const created = await createRoadmapItem(tx, track.id, item("x"));
    assert.equal(created?.completed_at, null);

    const done = await updateRoadmapItem(tx, created!.id, { status: "done" });
    assert.ok(done?.completed_at instanceof Date);

    const reopened = await updateRoadmapItem(tx, created!.id, { status: "in_progress" });
    assert.equal(reopened?.completed_at, null);

    // Back to done, then backdate completed_at: a redundant "done" must not
    // overwrite the original completion time.
    await updateRoadmapItem(tx, created!.id, { status: "done" });
    await tx
      .update(roadmapItems)
      .set({ completedAt: sql`now() - interval '3 days'` })
      .where(eq(roadmapItems.id, created!.id));
    const [{ before }] = await tx
      .select({ before: roadmapItems.completedAt })
      .from(roadmapItems)
      .where(eq(roadmapItems.id, created!.id));
    const again = await updateRoadmapItem(tx, created!.id, { status: "done" });
    assert.deepEqual(again?.completed_at, before);

    // Edits that don't touch status leave completed_at alone.
    const renamed = await updateRoadmapItem(tx, created!.id, { title: "renamed" });
    assert.deepEqual(renamed?.completed_at, before);
  });
});

test("topic_key must already exist in the track's registry", async () => {
  await inRolledBackTransaction(async (tx) => {
    const track = await insertTestTrack(tx, "__test__ topic_key");
    const other = await insertTestTrack(tx, "__test__ topic_key other");
    await insertTestTopicKey(tx, track.id, "calculus/limits");
    await insertTestTopicKey(tx, other.id, "calculus/series");

    await assert.rejects(
      createRoadmapItem(tx, track.id, { ...item("x"), topic_key: "calculus/unregistered" }),
      UnknownTopicKeyError,
    );
    // Registered, but on a different track: still rejected.
    await assert.rejects(
      createRoadmapItem(tx, track.id, { ...item("x"), topic_key: "calculus/series" }),
      UnknownTopicKeyError,
    );

    const ok = await createRoadmapItem(tx, track.id, { ...item("x"), topic_key: "calculus/limits" });
    assert.equal(ok?.topic_key, "calculus/limits");

    await assert.rejects(
      updateRoadmapItem(tx, ok!.id, { topic_key: "calculus/unregistered" }),
      UnknownTopicKeyError,
    );
    const cleared = await updateRoadmapItem(tx, ok!.id, { topic_key: null });
    assert.equal(cleared?.topic_key, null);
  });
});

test("list excludes skipped items unless explicitly included", async () => {
  await inRolledBackTransaction(async (tx) => {
    const track = await insertTestTrack(tx, "__test__ skipped");
    const kept = await createRoadmapItem(tx, track.id, item("kept"));
    const skipped = await createRoadmapItem(tx, track.id, item("skipped"));
    await updateRoadmapItem(tx, skipped!.id, { status: "skipped" });

    const visible = (await listRoadmapItems(tx, track.id))?.map((i) => i.id);
    assert.deepEqual(visible, [kept!.id]);
    const all = (await listRoadmapItems(tx, track.id, { includeSkipped: true }))?.map((i) => i.id);
    assert.deepEqual(all, [kept!.id, skipped!.id]);
  });
});

test("equal positions: older created_at first, then id — stable across queries", async () => {
  await inRolledBackTransaction(async (tx) => {
    const track = await insertTestTrack(tx, "__test__ position tie");
    // Same position, inserted newest-first, so insertion order can't be
    // what makes the result pass.
    const [newer] = await tx
      .insert(roadmapItems)
      .values({
        trackId: track.id,
        title: "newer",
        position: 100,
        estimatedMinutes: 30,
        createdAt: sql`now() - interval '1 hour'`,
      })
      .returning();
    const [older] = await tx
      .insert(roadmapItems)
      .values({
        trackId: track.id,
        title: "older",
        position: 100,
        estimatedMinutes: 30,
        createdAt: sql`now() - interval '2 hours'`,
      })
      .returning();
    assert.deepEqual(
      (await listRoadmapItems(tx, track.id))?.map((i) => i.id),
      [older.id, newer.id],
    );

    // Same position AND same created_at (one transaction, one now()):
    // the id breaks the tie, so repeated queries agree. Inserted in reverse
    // id order, so physical row order disagrees with the expected order.
    const low = "00000000-0000-4000-8000-000000000001";
    const high = "ffffffff-ffff-4fff-bfff-ffffffffffff";
    await tx.insert(roadmapItems).values([
      { id: high, trackId: track.id, title: "twin", position: 500, estimatedMinutes: 30 },
      { id: low, trackId: track.id, title: "twin", position: 500, estimatedMinutes: 30 },
    ]);
    const expected = [low, high];
    for (let i = 0; i < 3; i++) {
      const ids = (await listRoadmapItems(tx, track.id))
        ?.filter((item) => item.title === "twin")
        .map((item) => item.id);
      assert.deepEqual(ids, expected);
    }
  });
});

test("estimated_minutes > 0 is enforced by the database too, not just zod", async () => {
  await inRolledBackTransaction(async (tx) => {
    const track = await insertTestTrack(tx, "__test__ check");
    await assert.rejects(
      tx.insert(roadmapItems).values({
        trackId: track.id,
        title: "zero minutes",
        position: 0,
        estimatedMinutes: 0,
      }),
      (error: { cause?: { code?: string; constraint?: string } }) =>
        error.cause?.code === "23514" &&
        error.cause?.constraint === "roadmap_items_estimated_minutes_check",
    );
  });
});

test("unknown track returns null rather than creating anything", async () => {
  await inRolledBackTransaction(async (tx) => {
    const missing = "00000000-0000-4000-8000-000000000000";
    assert.equal(await createRoadmapItem(tx, missing, item("x")), null);
    assert.equal(await listRoadmapItems(tx, missing), null);
  });
});
