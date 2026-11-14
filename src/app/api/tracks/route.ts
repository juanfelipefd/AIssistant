import { NextResponse, type NextRequest } from "next/server";

import { withDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { readJson, validate } from "@/lib/http";
import {
  createTrack,
  createTrackSchema,
  listTracks,
  listTracksQuerySchema,
} from "@/lib/tracks";

/** Creates a track and its first relevance row, atomically. */
export async function POST(request: NextRequest) {
  const denied = await requireSession(request);
  if (denied) return denied;

  const input = await readJson(request, createTrackSchema);
  if (!input.ok) return input.response;

  const track = await withDb((db) => createTrack(db, input.data));
  return NextResponse.json(track, { status: 201 });
}

/**
 * Lists tracks with their current relevance. Archived tracks are excluded
 * unless ?include_archived=true.
 */
export async function GET(request: NextRequest) {
  const denied = await requireSession(request);
  if (denied) return denied;

  const query = validate(
    listTracksQuerySchema,
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!query.ok) return query.response;

  const includeArchived = query.data.include_archived === "true";
  const tracks = await withDb((db) => listTracks(db, { includeArchived }));
  return NextResponse.json(tracks);
}
