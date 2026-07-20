import { z } from "zod";
import { serializeOcrError } from "@/services/ocr/errors";

export async function readOcrJson(request: Request) {
  try {
    return await request.json();
  } catch {
    throw new z.ZodError([
      { code: z.ZodIssueCode.custom, path: [], message: "Request body must be valid JSON." },
    ]);
  }
}

export function handleOcrApiError(error: unknown) {
  if (error instanceof z.ZodError) {
    return Response.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid OCR request input.",
          issues: error.issues,
        },
      },
      { status: 422 },
    );
  }
  return serializeOcrError(error);
}
