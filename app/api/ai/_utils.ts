import { z } from "zod";
import { serializeAiError } from "@/services/ai/errors";

export async function readJson(request: Request) {
  try {
    return await request.json();
  } catch {
    throw new z.ZodError([
      { code: z.ZodIssueCode.custom, path: [], message: "Request body must be valid JSON." },
    ]);
  }
}

export function handleApiError(error: unknown) {
  if (error instanceof z.ZodError) {
    return Response.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request input.",
          issues: error.issues,
        },
      },
      { status: 422 },
    );
  }
  return serializeAiError(error);
}
