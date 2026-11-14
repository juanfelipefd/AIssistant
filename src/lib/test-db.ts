import "server-only";

import { withDb, type Tx } from "@/db";
import { topicKeys, tracks } from "@/db/schema";

// Test-only helpers. DB tests run against the real database inside a
// transaction that is always rolled back — nothing persists, and the
// track_relevance append-only trigger is never involved.

class Rollback extends Error {}

export async function inRolledBackTransaction(fn: (tx: Tx) => Promise<void>) {
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

export async function insertTestTrack(
  tx: Tx,
  name: string,
  status: "active" | "paused" | "archived" = "active",
) {
  const [track] = await tx
    .insert(tracks)
    .values({ name, kind: "study", charter: "", weeklyMinutesTarget: 60, status })
    .returning();
  return track;
}

export async function insertTestTopicKey(tx: Tx, trackId: string, key: string) {
  await tx.insert(topicKeys).values({ trackId, key });
}
