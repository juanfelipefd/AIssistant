import { NextResponse, type NextRequest } from "next/server";

import { withDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { notFound, readJson, validate } from "@/lib/http";
import {
  getTrack,
  trackIdSchema,
  updateTrack,
  updateTrackSchema,
} from "@/lib/tracks";

// No DELETE: tracks are archived (PATCH status = 'archived'), never deleted.

/** Track detail with its full relevance history. */
export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/tracks/[id]">,
) {
  const denied = await requireSession(request);
  if (denied) return denied;

  const id = validate(trackIdSchema, (await ctx.params).id);
  if (!id.ok) return id.response;

  const track = await withDb((db) => getTrack(db, id.data));
  return track ? NextResponse.json(track) : notFound("Track");
}

/**
 * Updates name, charter, weekly_minutes_target and/or status. Never touches
 * relevance — that is append-only via POST /api/tracks/[id]/relevance.
 */
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/tracks/[id]">,
) {
  const denied = await requireSession(request);
  if (denied) return denied;

  const id = validate(trackIdSchema, (await ctx.params).id);
  if (!id.ok) return id.response;

  const input = await readJson(request, updateTrackSchema);
  if (!input.ok) return input.response;

  const track = await withDb((db) => updateTrack(db, id.data, input.data));
  return track ? NextResponse.json(track) : notFound("Track");
}
