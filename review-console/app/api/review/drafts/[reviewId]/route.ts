import { NextResponse } from "next/server";
import { requireSameOrigin } from "@/lib/server/auth";
import { ReviewError, errorResponse } from "@/lib/server/errors";
import { readDraftUpdate } from "@/lib/server/input";
import { updateReviewDraft } from "@/lib/server/review-service";
import { decodeRouteId } from "@/lib/route-id";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ reviewId: string }> },
): Promise<NextResponse> {
  try {
    requireSameOrigin(request);
    const { reviewId } = await context.params;
    const decodedReviewId = decodeRouteId(reviewId);
    if (!decodedReviewId) {
      throw new ReviewError("Invalid draft id.", 400, "DRAFT_ID_INVALID");
    }
    const input = await readDraftUpdate(request);
    const result = await updateReviewDraft(decodedReviewId, input);
    return NextResponse.json({
      connection: result.context.connection,
      draft: result.draft,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
