import { NextResponse } from "next/server";
import { ReviewError, errorResponse } from "@/lib/server/errors";
import { getReviewBatch } from "@/lib/server/review-service";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ batchId: string }> },
): Promise<NextResponse> {
  try {
    const { batchId } = await context.params;
    const result = await getReviewBatch(decodeURIComponent(batchId));
    if (!result.batch) {
      throw new ReviewError("Batch not found.", 404, "BATCH_NOT_FOUND");
    }
    return NextResponse.json({
      connection: result.context.connection,
      batch: result.batch,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
