import { NextResponse, type NextRequest } from "next/server";

import { withDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { invalidField, notFound, readJson, validate } from "@/lib/http";
import {
  createRoadmapItem,
  createRoadmapItemSchema,
  listRoadmapItems,
  listRoadmapQuerySchema,
  UnknownTopicKeyError,
} from "@/lib/roadmap";
import { trackIdSchema } from "@/lib/tracks";

/** Appends a roadmap item at the end of the track (position = max + 100). */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/tracks/[id]/roadmap">,
) {
  const denied = await requireSession(request);
  if (denied) return denied;

  const id = validate(trackIdSchema, (await ctx.params).id);
  if (!id.ok) return id.response;

  const input = await readJson(request, createRoadmapItemSchema);
  if (!input.ok) return input.response;

  try {
    const item = await withDb((db) => createRoadmapItem(db, id.data, input.data));
    return item ? NextResponse.json(item, { status: 201 }) : notFound("Track");
  } catch (error) {
    if (error instanceof UnknownTopicKeyError) {
      return invalidField("topic_key", error.message);
    }
    throw error;
  }
}

/**
 * A track's roadmap in position order. Skipped items are excluded unless
 * ?include_skipped=true.
 */
export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/tracks/[id]/roadmap">,
) {
  const denied = await requireSession(request);
  if (denied) return denied;

  const id = validate(trackIdSchema, (await ctx.params).id);
  if (!id.ok) return id.response;

  const query = validate(
    listRoadmapQuerySchema,
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!query.ok) return query.response;

  const includeSkipped = query.data.include_skipped === "true";
  const items = await withDb((db) =>
    listRoadmapItems(db, id.data, { includeSkipped }),
  );
  return items ? NextResponse.json(items) : notFound("Track");
}
