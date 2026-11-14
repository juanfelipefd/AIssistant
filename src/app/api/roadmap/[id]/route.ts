import { NextResponse, type NextRequest } from "next/server";

import { withDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { invalidField, notFound, readJson, validate } from "@/lib/http";
import {
  roadmapItemIdSchema,
  UnknownTopicKeyError,
  updateRoadmapItem,
  updateRoadmapItemSchema,
} from "@/lib/roadmap";

// No DELETE: status = 'skipped' is the soft-delete.

/**
 * Updates title, description, status, position, estimated_minutes and/or
 * topic_key. Moving into 'done' sets completed_at; moving out clears it.
 */
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/roadmap/[id]">,
) {
  const denied = await requireSession(request);
  if (denied) return denied;

  const id = validate(roadmapItemIdSchema, (await ctx.params).id);
  if (!id.ok) return id.response;

  const input = await readJson(request, updateRoadmapItemSchema);
  if (!input.ok) return input.response;

  try {
    const item = await withDb((db) => updateRoadmapItem(db, id.data, input.data));
    return item ? NextResponse.json(item) : notFound("Roadmap item");
  } catch (error) {
    if (error instanceof UnknownTopicKeyError) {
      return invalidField("topic_key", error.message);
    }
    throw error;
  }
}
