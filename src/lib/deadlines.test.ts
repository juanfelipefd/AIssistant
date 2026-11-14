import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createDeadline,
  deleteDeadline,
  listDeadlines,
  updateDeadline,
} from "@/lib/deadlines";
import { inRolledBackTransaction, insertTestTrack } from "@/lib/test-db";

test("deadlines list by due_date; update; delete removes the row", async () => {
  await inRolledBackTransaction(async (tx) => {
    const track = await insertTestTrack(tx, "__test__ deadlines");
    const final = await createDeadline(tx, track.id, { label: "Final", due_date: "2026-12-10" });
    const midterm = await createDeadline(tx, track.id, {
      label: "Midterm",
      due_date: "2026-11-20",
      notes: "Chapters 1-7",
    });

    assert.deepEqual(
      (await listDeadlines(tx, track.id))?.map((d) => d.label),
      ["Midterm", "Final"],
    );

    const moved = await updateDeadline(tx, final!.id, { due_date: "2026-11-15", notes: null });
    assert.equal(moved?.due_date, "2026-11-15");
    assert.deepEqual(
      (await listDeadlines(tx, track.id))?.map((d) => d.label),
      ["Final", "Midterm"],
    );

    assert.equal(await deleteDeadline(tx, midterm!.id), true);
    assert.equal(await deleteDeadline(tx, midterm!.id), false);
    assert.deepEqual((await listDeadlines(tx, track.id))?.map((d) => d.label), ["Final"]);
  });
});

test("unknown track or deadline returns null", async () => {
  await inRolledBackTransaction(async (tx) => {
    const missing = "00000000-0000-4000-8000-000000000000";
    assert.equal(await createDeadline(tx, missing, { label: "x", due_date: "2026-12-01" }), null);
    assert.equal(await listDeadlines(tx, missing), null);
    assert.equal(await updateDeadline(tx, missing, { label: "y" }), null);
  });
});
