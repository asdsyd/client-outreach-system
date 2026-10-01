import { NextResponse } from "next/server";
import { requireSameOrigin } from "@/lib/server/auth";
import { errorResponse } from "@/lib/server/errors";
import { readBatchCreate } from "@/lib/server/input";
import { createReviewBatch } from "@/lib/server/review-service";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    requireSameOrigin(request);
    const input = await readBatchCreate(request);
    const result = await createReviewBatch(input);
    return NextResponse.json(
      {
        connection: result.context.connection,
        batch: result.batch,
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
