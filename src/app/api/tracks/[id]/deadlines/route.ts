import { NextResponse, type NextRequest } from "next/server";

import { withDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { createDeadline, createDeadlineSchema, listDeadlines } from "@/lib/deadlines";
import { notFound, readJson, validate } from "@/lib/http";
import { trackIdSchema } from "@/lib/tracks";

/** Adds a deadline to a track. */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/tracks/[id]/deadlines">,
) {
  const denied = await requireSession(request);
  if (denied) return denied;

  const id = validate(trackIdSchema, (await ctx.params).id);
  if (!id.ok) return id.response;

  const input = await readJson(request, createDeadlineSchema);
  if (!input.ok) return input.response;

  const deadline = await withDb((db) => createDeadline(db, id.data, input.data));
  return deadline ? NextResponse.json(deadline, { status: 201 }) : notFound("Track");
}

/** A track's deadlines, soonest first. */
export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/tracks/[id]/deadlines">,
) {
  const denied = await requireSession(request);
  if (denied) return denied;

  const id = validate(trackIdSchema, (await ctx.params).id);
  if (!id.ok) return id.response;

  const deadlines = await withDb((db) => listDeadlines(db, id.data));
  return deadlines ? NextResponse.json(deadlines) : notFound("Track");
}
