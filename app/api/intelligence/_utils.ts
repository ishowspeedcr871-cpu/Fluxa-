import { z } from "zod";
import { serializeIntelligenceError } from "@/services/intelligence/errors";

export async function readIntelligenceJson(request: Request) {
  try {
    return await request.json();
  } catch {
    throw new z.ZodError([
      { code: z.ZodIssueCode.custom, path: [], message: "Request body must be valid JSON." },
    ]);
  }
}

export function handleIntelligenceApiError(error: unknown) {
  if (error instanceof z.ZodError) {
    return Response.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid intelligence input.",
          issues: error.issues,
        },
      },
      { status: 422 },
    );
  }
  return serializeIntelligenceError(error);
}
