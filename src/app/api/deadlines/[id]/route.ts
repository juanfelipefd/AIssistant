import { NextResponse, type NextRequest } from "next/server";

import { withDb } from "@/db";
import { requireSession } from "@/lib/auth";
import {
  deadlineIdSchema,
  deleteDeadline,
  updateDeadline,
  updateDeadlineSchema,
} from "@/lib/deadlines";
import { notFound, readJson, validate } from "@/lib/http";

/** Updates label, due_date and/or notes. */
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/deadlines/[id]">,
) {
  const denied = await requireSession(request);
  if (denied) return denied;

  const id = validate(deadlineIdSchema, (await ctx.params).id);
  if (!id.ok) return id.response;

  const input = await readJson(request, updateDeadlineSchema);
  if (!input.ok) return input.response;

  const deadline = await withDb((db) => updateDeadline(db, id.data, input.data));
  return deadline ? NextResponse.json(deadline) : notFound("Deadline");
}

/** Deletes a deadline. Allowed: nothing references deadlines. */
export async function DELETE(
  request: NextRequest,
  ctx: RouteContext<"/api/deadlines/[id]">,
) {
  const denied = await requireSession(request);
  if (denied) return denied;

  const id = validate(deadlineIdSchema, (await ctx.params).id);
  if (!id.ok) return id.response;

  const deleted = await withDb((db) => deleteDeadline(db, id.data));
  return deleted ? new NextResponse(null, { status: 204 }) : notFound("Deadline");
}
