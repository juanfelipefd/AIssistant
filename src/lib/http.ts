import { NextResponse } from "next/server";
import type { z } from "zod";

type Parsed<T> = { ok: true; data: T } | { ok: false; response: NextResponse };

/**
 * Validates `input` against a zod schema. On failure, returns a 400 response
 * listing every issue (path + message) for the route to return as-is.
 */
export function validate<S extends z.ZodType>(
  schema: S,
  input: unknown,
): Parsed<z.infer<S>> {
  const result = schema.safeParse(input);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  return {
    ok: false,
    response: NextResponse.json(
      {
        error: "Invalid input",
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    ),
  };
}

/** Parses a JSON request body, then validates it. Malformed JSON is a 400. */
export async function readJson<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<Parsed<z.infer<S>>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Request body must be valid JSON" },
        { status: 400 },
      ),
    };
  }
  return validate(schema, body);
}

export function notFound(what: string): NextResponse {
  return NextResponse.json({ error: `${what} not found` }, { status: 404 });
}
