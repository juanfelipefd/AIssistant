import { NextResponse, type NextRequest } from "next/server";

import { withDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { notFound, readJson, validate } from "@/lib/http";
import {
  appendRelevance,
  appendRelevanceSchema,
  trackIdSchema,
} from "@/lib/tracks";

/** Appends a new relevance judgement. Existing rows are never changed. */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/tracks/[id]/relevance">,
) {
  const denied = await requireSession(request);
  if (denied) return denied;

  const id = validate(trackIdSchema, (await ctx.params).id);
  if (!id.ok) return id.response;

  const input = await readJson(request, appendRelevanceSchema);
  if (!input.ok) return input.response;

  const relevance = await withDb((db) =>
    appendRelevance(db, id.data, input.data),
  );
  return relevance
    ? NextResponse.json(relevance, { status: 201 })
    : notFound("Track");
}
